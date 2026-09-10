#!/usr/bin/env node
/**
 * Configuration-boundary regression gate (Global Rule 12).
 *
 * Fails the build if environment access, provider configuration, plan pricing, or
 * secret-shaped literals are reintroduced into business code. Zero dependencies so it
 * runs anywhere `node` does.
 *
 *   node scripts/check-config-boundary.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const SCAN_ROOTS = ['src', 'api', 'deploy', 'mobile/lib', 'mobile/test'];
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.dart'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'out',
  'android',
  'ios',
  'dist',
  'build',
  '.dart_tool',
]);

/** The single files permitted to own each class of value. */
const CONFIG_MODULE = 'src/lib/config.ts';
const PLANS_MODULE = 'src/lib/plans.ts';

/**
 * The Flutter client is a second runtime with the same rule and its own owner file.
 *
 * Dart has no `process.env` at runtime on a mobile device — a release build has no shell to
 * inherit one from. Its equivalent is `String.fromEnvironment`, resolved at COMPILE time from
 * `--dart-define`, which makes it exactly as baked-in as `NEXT_PUBLIC_*` and exactly as much
 * of a boundary. `dart_define.example.json` is the Dart `.env.example`: names and safe
 * placeholders only, never a real value.
 */
const DART_CONFIG_MODULE = 'mobile/lib/src/config/app_config.dart';
const DART_DEFINE_EXAMPLE = 'mobile/dart_define.example.json';

const TS = ['.ts', '.tsx'];
const DART = ['.dart'];

const RULES = [
  {
    id: 'env-access-outside-config',
    description: `process.env may only be read in ${CONFIG_MODULE}`,
    pattern: /process\.env\./,
    appliesTo: TS,
    allow: [CONFIG_MODULE],
  },
  {
    id: 'dart-env-access-outside-config',
    description: `compile-time environment values may only be read in ${DART_CONFIG_MODULE}`,
    // `Platform.environment` is included even though it is empty on a released mobile app:
    // reading it is a sign someone is reaching for configuration in the wrong place, and it
    // is NOT empty on the desktop and test targets where it would then silently disagree.
    pattern: /(?:String|int|bool|double)\.fromEnvironment|Platform\.environment/,
    appliesTo: DART,
    allow: [DART_CONFIG_MODULE],
  },
  {
    id: 'hardcoded-model-id',
    description: `model IDs must come from ${CONFIG_MODULE} / ${DART_CONFIG_MODULE}`,
    pattern: /['"`](?:gemini-[\w.-]+|gpt-[\w.-]+|claude-[a-z]+-[\w.-]+|o[13]-[\w.-]+)['"`]/,
    allow: [CONFIG_MODULE, DART_CONFIG_MODULE],
  },
  {
    id: 'hardcoded-provider-endpoint',
    description: `provider/API base URLs must come from ${CONFIG_MODULE} / ${DART_CONFIG_MODULE}`,
    // `api.pwnedpasswords.com` is in this list because the Flutter client performs the same
    // k-anonymity breach lookup as src/lib/password-safety.ts. Two runtimes hardcoding the
    // same third-party endpoint is precisely the drift this rule exists to prevent.
    pattern:
      /['"`]https:\/\/(?:api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|nominatim\.openstreetmap\.org|api\.pwnedpasswords\.com|[a-z0-9-]+\.supabase\.co)/,
    allow: [CONFIG_MODULE, DART_CONFIG_MODULE],
  },
  {
    id: 'hardcoded-api-version',
    description: `provider API version headers must come from ${CONFIG_MODULE}`,
    pattern: /['"`]anthropic-version['"`]\s*:\s*['"`][\d-]+['"`]/,
    appliesTo: TS,
    allow: [CONFIG_MODULE],
  },
  {
    id: 'duplicated-plan-price',
    description: `plan prices belong only in ${PLANS_MODULE}`,
    pattern: /(?:price\s*:\s*\d|['"`]\$\d+['"`])/,
    allow: [PLANS_MODULE],
  },
  {
    id: 'dart-supabase-bucket-name',
    description:
      'the evidence bucket name is a contract with the storage migration — it belongs in ' +
      `${DART_CONFIG_MODULE}, not next to an upload call`,
    // DEF-017 was made permanent by the bucket and path shape being restated at each call
    // site. The Dart client stores evidence under the same contract; this keeps the string in
    // one place so a rename cannot half-land.
    pattern: /\.from\(\s*['"]evidence['"]\s*\)/,
    appliesTo: DART,
    allow: [DART_CONFIG_MODULE, 'mobile/lib/src/data/evidence_repository.dart'],
  },
  {
    id: 'secret-shaped-literal',
    description: 'secret-shaped literal committed to source',
    // Live/real credential shapes. Test-mode and placeholder forms are excluded on purpose.
    pattern:
      /(?:sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)/,
    allow: [],
  },
];

/**
 * Strip comments so an explanatory comment cannot trip a rule.
 * The negative lookbehind on `:` is load-bearing — without it `https://` is read as the
 * start of a line comment and every hardcoded URL becomes invisible to the scanner.
 */
function stripComments(line) {
  return line.replace(/\/\*.*?\*\//g, '').replace(/(?<!:)\/\/.*$/, '');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((root) => {
  try {
    return walk(root);
  } catch {
    return [];
  }
});

const violations = [];

for (const file of files) {
  const relative = file.split(sep).join(posix.sep);
  const extension = relative.slice(relative.lastIndexOf('.'));
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  for (const rule of RULES) {
    // A rule with no `appliesTo` is language-agnostic and runs everywhere. One that names
    // extensions runs only there — `process.env` is meaningless in Dart and
    // `String.fromEnvironment` is meaningless in TypeScript, and a rule that fires on the
    // wrong language teaches people to ignore the gate.
    if (rule.appliesTo && !rule.appliesTo.includes(extension)) continue;
    if (rule.allow.includes(relative)) continue;

    lines.forEach((raw, index) => {
      const line = stripComments(raw);
      if (rule.pattern.test(line)) {
        violations.push({
          file: relative,
          line: index + 1,
          rule: rule.id,
          description: rule.description,
          // Never echo the match itself — it may be the secret we just caught.
          excerpt: line.trim().slice(0, 60),
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------
// Every compile-time Dart define must be documented.
//
// A `--dart-define` that nobody wrote down is invisible: it has a silent default baked into
// the binary, it is absent from every build command, and the first symptom is an app in the
// field talking to the wrong backend. `.env.example` plays this role for the web target;
// `dart_define.example.json` plays it here, and this check is what keeps it honest — names
// and safe placeholders only, never a real value (Rule 12).
// ---------------------------------------------------------------------------------------
if (existsSync(DART_CONFIG_MODULE)) {
  const source = readFileSync(DART_CONFIG_MODULE, 'utf8');
  const declared = new Set(
    [...source.matchAll(/\.fromEnvironment\(\s*'([A-Z0-9_]+)'/g)].map((m) => m[1])
  );

  let documented = new Set();
  if (existsSync(DART_DEFINE_EXAMPLE)) {
    try {
      documented = new Set(Object.keys(JSON.parse(readFileSync(DART_DEFINE_EXAMPLE, 'utf8'))));
    } catch (error) {
      violations.push({
        file: DART_DEFINE_EXAMPLE,
        line: 1,
        rule: 'dart-define-example-unparseable',
        description: `not valid JSON, so --dart-define-from-file would fail: ${error.message}`,
        excerpt: '',
      });
    }
  } else {
    violations.push({
      file: DART_DEFINE_EXAMPLE,
      line: 1,
      rule: 'dart-define-example-missing',
      description: 'the Dart client has compile-time configuration but no documented example',
      excerpt: '',
    });
  }

  for (const key of declared) {
    if (!documented.has(key)) {
      violations.push({
        file: DART_DEFINE_EXAMPLE,
        line: 1,
        rule: 'dart-define-undocumented',
        description: `${key} is read by the app but is not in the example file`,
        excerpt: '',
      });
    }
  }

  for (const key of documented) {
    // JSON has no comments, and a file of two dozen opaque keys with no way to say what they
    // are or which ones must never appear is a file nobody can use safely. Keys prefixed with
    // `_` are notes, not defines. They are ignored here (and passing one to
    // `--dart-define-from-file` merely defines a constant nothing reads).
    if (key.startsWith('_')) continue;
    if (!declared.has(key)) {
      violations.push({
        file: DART_DEFINE_EXAMPLE,
        line: 1,
        rule: 'dart-define-unused',
        description: `${key} is documented but nothing reads it — a define nobody consumes is a lie`,
        excerpt: '',
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`\n✖ Configuration boundary violated (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
    console.error(`    ${v.description}`);
  }
  console.error(
    `\nMove the value into ${CONFIG_MODULE} (environment/deployment config) or\n` +
      `${PLANS_MODULE} (plan product data), then read it from there.\n`
  );
  process.exit(1);
}

console.log(`✓ Configuration boundary intact — ${files.length} files, ${RULES.length} rules, 0 violations.`);
