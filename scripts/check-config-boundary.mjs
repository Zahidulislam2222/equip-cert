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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const SCAN_ROOTS = ['src', 'api', 'deploy'];
const SCAN_EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'android', 'dist', 'build']);

/** The single files permitted to own each class of value. */
const CONFIG_MODULE = 'src/lib/config.ts';
const PLANS_MODULE = 'src/lib/plans.ts';

const RULES = [
  {
    id: 'env-access-outside-config',
    description: `process.env may only be read in ${CONFIG_MODULE}`,
    pattern: /process\.env\./,
    allow: [CONFIG_MODULE],
  },
  {
    id: 'hardcoded-model-id',
    description: `model IDs must come from ${CONFIG_MODULE}`,
    pattern: /['"`](?:gemini-[\w.-]+|gpt-[\w.-]+|claude-[a-z]+-[\w.-]+|o[13]-[\w.-]+)['"`]/,
    allow: [CONFIG_MODULE],
  },
  {
    id: 'hardcoded-provider-endpoint',
    description: `provider/API base URLs must come from ${CONFIG_MODULE}`,
    pattern:
      /['"`]https:\/\/(?:api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|nominatim\.openstreetmap\.org|[a-z0-9-]+\.supabase\.co)/,
    allow: [CONFIG_MODULE],
  },
  {
    id: 'hardcoded-api-version',
    description: `provider API version headers must come from ${CONFIG_MODULE}`,
    pattern: /['"`]anthropic-version['"`]\s*:\s*['"`][\d-]+['"`]/,
    allow: [CONFIG_MODULE],
  },
  {
    id: 'duplicated-plan-price',
    description: `plan prices belong only in ${PLANS_MODULE}`,
    pattern: /(?:price\s*:\s*\d|['"`]\$\d+['"`])/,
    allow: [PLANS_MODULE],
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
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  for (const rule of RULES) {
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
