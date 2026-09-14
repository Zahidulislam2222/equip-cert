#!/usr/bin/env node
/**
 * Generate every deployment artifact from its single owner (Global Rule 12).
 *
 *   topology, ports, limits, probes, scaling  <- deploy/deploy.config.json
 *   security response headers                 <- vercel.json
 *
 * Outputs:
 *
 *   deploy/generated/<slug>.caddy   per release, gitignored   shared-VPS reverse proxy + LB pool
 *   deploy/generated/compose.yaml   per release, gitignored   N replicas on the shared VPS
 *   deploy/k8s/*.yaml               committed, drift-checked  reference multi-node topology
 *
 * Writing any of these by hand would fork them from their owner. The VPS once came within one
 * hand-written file of serving the app with no CSP while Vercel kept one; generating every target
 * from the same sources makes that impossible, and `--check` makes the committed manifests unable
 * to drift from deploy.config.json without CI noticing.
 *
 *   node scripts/gen-deploy-artifacts.mjs --release <release-id> [--image-ref <ref>]
 *   node scripts/gen-deploy-artifacts.mjs --k8s-only
 *   node scripts/gen-deploy-artifacts.mjs --check          (CI: fail if deploy/k8s is stale)
 *   node scripts/gen-deploy-artifacts.mjs --check --replicas 3 --out-dir <dir>
 *        (render the VPS artifacts at another replica count without touching deploy/generated)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument --${name}`);
}

const CHECK = flag('check');
const K8S_ONLY = flag('k8s-only');

const deployCfg = JSON.parse(readFileSync('deploy/deploy.config.json', 'utf8'));
const vercelCfg = JSON.parse(readFileSync('vercel.json', 'utf8'));

const { slug, hostname, loopbackPort, containerPort, resources, proxy, shutdown, runtime, healthcheck, kubernetes: k8s } =
  deployCfg;

/** Injected into every generated container, so the values the invariants check are the values that run. */
const runtimeEnv = {
  SELF_HOST_DRAIN_DELAY_MS: String(runtime.drainDelayMs),
  SELF_HOST_SHUTDOWN_GRACE_MS: String(runtime.shutdownGraceMs),
  SELF_HOST_KEEPALIVE_TIMEOUT_MS: String(runtime.keepAliveTimeoutMs),
  SELF_HOST_REQUEST_TIMEOUT_MS: String(runtime.requestTimeoutMs),
};
const replicas = Number(arg('replicas', String(deployCfg.replicas)));

// ------------------------------------------------------------------ invariants
//
// The numbers below only work together. A health check slower than the drain delay routes
// traffic into a closing process; a kill timeout shorter than drain + grace SIGKILLs requests
// mid-response. Those relationships live in three files (this config, config.ts defaults and
// the probes), so they are asserted here against deploy.config.json `runtime` — the same values
// the generator injects into the container environment — rather than against copied defaults.
const fail = (msg) => {
  console.error(`✗ deploy.config.json: ${msg}`);
  process.exit(1);
};
if (!Number.isInteger(replicas) || replicas < 1) fail(`replicas must be a positive integer, got ${replicas}`);
if (!Number.isInteger(loopbackPort) || loopbackPort + replicas - 1 > 65535) fail('loopback port range exceeds 65535');
for (const key of ['drainDelayMs', 'shutdownGraceMs', 'keepAliveTimeoutMs', 'requestTimeoutMs']) {
  if (!Number.isInteger(runtime?.[key]) || runtime[key] <= 0) fail(`runtime.${key} must be a positive integer`);
}
if (typeof healthcheck?.livenessPath !== 'string' || !healthcheck.livenessPath.startsWith('/')) {
  fail('healthcheck.livenessPath must be an absolute path');
}
for (const key of ['revisionHistoryLimit', 'maxSurge', 'servicePort', 'tmpSizeLimit', 'startupProbe', 'readinessFailureThreshold', 'autoscalingBehavior']) {
  if (k8s?.[key] === undefined) fail(`kubernetes.${key} is required`);
}
// Worst case, the proxy notices a draining replica one full check (interval + timeout) after it
// starts answering 503. The drain delay must cover that, or requests land on a closing process.
if ((proxy.healthIntervalSeconds + proxy.healthTimeoutSeconds) * 1000 >= runtime.drainDelayMs) {
  fail(
    `proxy.healthIntervalSeconds + healthTimeoutSeconds must be below runtime.drainDelayMs ` +
      `(${runtime.drainDelayMs} ms)`,
  );
}
// src/lib/config.ts keeps defaults for running the server outside a generated deployment. They
// must equal the values here, or a hand-run server and a generated one behave differently.
{
  const configSource = (await import('node:fs')).readFileSync(new URL('../src/lib/config.ts', import.meta.url), 'utf8');
  for (const [name, value] of Object.entries(runtimeEnv)) {
    const m = configSource.match(new RegExp(`process\\.env\\.${name},\\s*([\\d_]+)\\)`));
    if (!m) fail(`src/lib/config.ts has no integer default for ${name}`);
    else if (m[1].replace(/_/g, '') !== value) {
      fail(`src/lib/config.ts default for ${name} is ${m[1]}, deploy.config.json runtime says ${value}`);
    }
  }
}
// Not an error, but not free either: a request still running when the grace period ends is cut.
if (runtime.requestTimeoutMs > runtime.shutdownGraceMs) {
  console.warn(
    `note: runtime.requestTimeoutMs (${runtime.requestTimeoutMs} ms) exceeds shutdownGraceMs ` +
      `(${runtime.shutdownGraceMs} ms) — a request longer than the grace is cut during a deploy.`,
  );
}
if (proxy.upstreamKeepaliveSeconds * 1000 >= runtime.keepAliveTimeoutMs) {
  fail(`proxy.upstreamKeepaliveSeconds must be below runtime.keepAliveTimeoutMs (${runtime.keepAliveTimeoutMs} ms)`);
}
if (shutdown.stopGraceSeconds * 1000 <= runtime.drainDelayMs + runtime.shutdownGraceMs) {
  fail(
    `shutdown.stopGraceSeconds must exceed runtime.drainDelayMs + runtime.shutdownGraceMs ` +
      `(${runtime.drainDelayMs + runtime.shutdownGraceMs} ms)`,
  );
}
if (k8s.minAvailable >= k8s.minReplicas) fail('kubernetes.minAvailable must be below minReplicas, or no node can ever drain');

/** Pull the catch-all header block out of vercel.json so every target stays identical. */
function securityHeaders() {
  const block = vercelCfg.headers?.find((h) => h.source === '/(.*)');
  if (!block) throw new Error('vercel.json has no /(.*) header block to derive from');
  return block.headers;
}

// ------------------------------------------------------------------ Caddy site file
//
// X-Forwarded-For handling is deliberate. Caddy APPENDS to a client-supplied X-Forwarded-For,
// and the API handlers rate-limit on its FIRST value — so a forged header would hand any caller a
// fresh rate-limit bucket. Both branches overwrite the header with a value the client cannot
// choose.
//
// The upstream pool: active health checks against the READINESS endpoint (not liveness), so a
// replica that is draining for a deploy leaves rotation before it stops accepting connections.
// least_conn because /api/analyze requests are long and uneven — round robin would stack them.
// lb_try_duration retries a request whose connection was refused on another replica.
function renderCaddy() {
  const headerLines = securityHeaders()
    .map((h) => `        ${h.key} "${h.value.replaceAll('"', '\\"')}"`)
    .join('\n');

  const upstreams = Array.from({ length: replicas }, (_, i) => `127.0.0.1:${loopbackPort + i}`).join(' ');

  const proxyBlock = (forwardedFor) => `        reverse_proxy ${upstreams} {
            lb_policy ${proxy.lbPolicy}
            lb_try_duration ${proxy.lbTryDurationSeconds}s
            health_uri ${proxy.readinessPath}
            health_interval ${proxy.healthIntervalSeconds}s
            health_timeout ${proxy.healthTimeoutSeconds}s
            fail_duration ${proxy.failDurationSeconds}s
            transport http {
                keepalive ${proxy.upstreamKeepaliveSeconds}s
            }
            header_up X-Forwarded-For ${forwardedFor}
        }`;

  return `# GENERATED by scripts/gen-deploy-artifacts.mjs — do not hand-edit.
# Source: deploy/deploy.config.json + vercel.json   replicas=${replicas}
${hostname} {
    header {
${headerLines}
        -Server
    }

    @cf header CF-Connecting-IP *
    handle @cf {
${proxyBlock('{http.request.header.CF-Connecting-IP}')}
    }

    handle {
${proxyBlock('{http.request.remote.host}')}
    }

    log
}
`;
}

// ------------------------------------------------------------------ compose file
//
// Ports are bound explicitly to 127.0.0.1 so UFW is never bypassed by Docker's own iptables
// rules. The image tag is baked per release so rollback is exact. The first replica keeps the
// service name `web` so existing rollback commands keep working at replicas=1.
function renderCompose(imageRef) {
  const services = Array.from({ length: replicas }, (_, i) => {
    const name = i === 0 ? 'web' : `web-${i + 1}`;
    return `  ${name}:
    <<: *web
    ports:
      - "127.0.0.1:${loopbackPort + i}:${containerPort}"`;
  }).join('\n');

  return `# GENERATED by scripts/gen-deploy-artifacts.mjs — do not hand-edit.
# Source: deploy/deploy.config.json   replicas=${replicas}
name: ${slug}

x-web: &web
  image: ${imageRef}
  restart: unless-stopped
  env_file:
    - ./app.env
  # Lifecycle timings from deploy.config.json runtime; \`environment\` overrides app.env.
  environment:
${Object.entries(runtimeEnv)
  .map(([k, v]) => `    ${k}: "${v}"`)
  .join('\n')}
  mem_limit: ${resources.memLimit}
  cpus: ${resources.cpus}
  pids_limit: ${resources.pidsLimit}
  read_only: true
  tmpfs:
    - /tmp
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true
  # SIGTERM starts the drain in deploy/server.ts; SIGKILL arrives only after this.
  stop_signal: SIGTERM
  stop_grace_period: ${shutdown.stopGraceSeconds}s
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:${containerPort}${healthcheck.livenessPath}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: ${healthcheck.intervalSeconds}s
    timeout: ${healthcheck.timeoutSeconds}s
    retries: ${healthcheck.retries}
    start_period: ${healthcheck.startPeriodSeconds}s

services:
${services}
`;
}

// ------------------------------------------------------------------ Kubernetes manifests
//
// A dependency-free YAML emitter for plain data. Strings are always JSON-quoted, which is valid
// YAML and removes every "is this a boolean / a number / a date" ambiguity YAML is known for.
function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return ' []';
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const body = toYaml(item, indent + 2).replace(/^\n/, '');
          return `\n${pad}- ${body.slice(indent + 2)}`;
        }
        return `\n${pad}- ${scalar(item)}`;
      })
      .join('');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return ' {}';
    return entries
      .map(([k, v]) => {
        if (v && typeof v === 'object') return `\n${pad}${k}:${toYaml(v, indent + 2)}`;
        return `\n${pad}${k}: ${scalar(v)}`;
      })
      .join('');
  }
  return ` ${scalar(value)}`;
}
function scalar(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}
const doc = (header, obj) => `${header}${toYaml(obj).replace(/^\n/, '')}\n`;

function renderK8s() {
  const labels = { 'app.kubernetes.io/name': slug, 'app.kubernetes.io/component': 'web' };
  const metadata = (name) => ({ name, namespace: k8s.namespace, labels });
  const header = (what) =>
    `# GENERATED by scripts/gen-deploy-artifacts.mjs from deploy/deploy.config.json — do not hand-edit.\n` +
    `# ${what}\n`;

  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metadata(slug),
    spec: {
      replicas: k8s.replicas,
      revisionHistoryLimit: k8s.revisionHistoryLimit,
      selector: { matchLabels: labels },
      // Never below full capacity during a rollout: a new pod must be READY before an old one
      // is removed. Together with the readiness drain this is what "zero-downtime deploy" means.
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: k8s.maxSurge } },
      template: {
        metadata: { labels },
        spec: {
          automountServiceAccountToken: false,
          terminationGracePeriodSeconds: shutdown.stopGraceSeconds,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: k8s.runAsUser,
            runAsGroup: k8s.runAsUser,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          // Spread across zones first, then nodes, so one zone or one node failing removes a
          // fraction of capacity rather than all of it. ScheduleAnyway so a small cluster still
          // schedules instead of leaving pods Pending.
          topologySpreadConstraints: [
            {
              maxSkew: 1,
              topologyKey: 'topology.kubernetes.io/zone',
              whenUnsatisfiable: 'ScheduleAnyway',
              labelSelector: { matchLabels: labels },
            },
            {
              maxSkew: 1,
              topologyKey: 'kubernetes.io/hostname',
              whenUnsatisfiable: 'ScheduleAnyway',
              labelSelector: { matchLabels: labels },
            },
          ],
          containers: [
            {
              name: 'web',
              image: k8s.image,
              // The committed image is a mutable tag placeholder; Always stops a node running a stale
              // copy of it. A release overlay pins a digest, which makes the pull policy moot.
              imagePullPolicy: 'Always',
              ports: [{ name: 'http', containerPort }],
              // Explicit env wins over envFrom, so the ConfigMap cannot desynchronise the timings
              // the invariants above were checked against.
              env: [
                { name: 'SELF_HOST_PORT', value: String(containerPort) },
                ...Object.entries(runtimeEnv).map(([name, value]) => ({ name, value })),
              ],
              envFrom: [{ configMapRef: { name: k8s.configMapName } }, { secretRef: { name: k8s.secretName } }],
              resources: { requests: k8s.requests, limits: k8s.limits },
              startupProbe: {
                httpGet: { path: healthcheck.livenessPath, port: 'http' },
                periodSeconds: k8s.startupProbe.periodSeconds,
                failureThreshold: k8s.startupProbe.failureThreshold,
              },
              readinessProbe: {
                httpGet: { path: proxy.readinessPath, port: 'http' },
                periodSeconds: proxy.healthIntervalSeconds,
                timeoutSeconds: proxy.healthTimeoutSeconds,
                failureThreshold: k8s.readinessFailureThreshold,
              },
              // Liveness is the cheap endpoint and is patient: restarting a replica that is merely
              // slow under load converts a slowdown into an outage.
              livenessProbe: {
                httpGet: { path: healthcheck.livenessPath, port: 'http' },
                periodSeconds: healthcheck.intervalSeconds,
                timeoutSeconds: healthcheck.timeoutSeconds,
                failureThreshold: healthcheck.retries,
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ['ALL'] },
              },
              volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
            },
          ],
          volumes: [{ name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: k8s.tmpSizeLimit } }],
        },
      },
    },
  };

  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: metadata(slug),
    spec: { type: 'ClusterIP', selector: labels, ports: [{ name: 'http', port: k8s.servicePort, targetPort: 'http' }] },
  };

  const hpa = {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: metadata(slug),
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: slug },
      minReplicas: k8s.minReplicas,
      maxReplicas: k8s.maxReplicas,
      metrics: [
        { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: k8s.targetCpuPercent } } },
      ],
      // Scale up fast, scale down slowly — the rationale sits next to the values in deploy.config.json.
      behavior: k8s.autoscalingBehavior,
    },
  };

  const pdb = {
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata: metadata(slug),
    spec: { minAvailable: k8s.minAvailable, selector: { matchLabels: labels } },
  };

  // Only the ingress controller's namespace may reach the pods, and only on the application port.
  // Without `from`, every pod in the cluster could. Egress stays open: the app must reach Supabase
  // and the AI provider, whose addresses are not stable enough to pin.
  const networkPolicy = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: metadata(slug),
    spec: {
      podSelector: { matchLabels: labels },
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': k8s.ingressNamespace } } }],
          ports: [{ protocol: 'TCP', port: containerPort }],
        },
      ],
    },
  };

  const namespace = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: k8s.namespace } };

  const files = {
    'namespace.yaml': doc(header('Namespace.'), namespace),
    'deployment.yaml': doc(header('Deployment: rolling update at full capacity, readiness drain, restricted pod security.'), deployment),
    'service.yaml': doc(header('Service.'), service),
    'hpa.yaml': doc(header(`Autoscaler: ${k8s.minReplicas}-${k8s.maxReplicas} replicas on CPU.`), hpa),
    'pdb.yaml': doc(header('Disruption budget: node drains never take the app below minAvailable.'), pdb),
    'networkpolicy.yaml': doc(header('Ingress only from the ingress controller namespace, only on the application port.'), networkPolicy),
  };
  files['kustomization.yaml'] =
    header('Apply with: kubectl apply -k deploy/k8s  (set the image per release in an overlay).') +
    toYaml({
      apiVersion: 'kustomize.config.k8s.io/v1beta1',
      kind: 'Kustomization',
      resources: Object.keys(files),
    }).replace(/^\n/, '') +
    '\n';
  return files;
}

// ------------------------------------------------------------------ write / check
const K8S_DIR = 'deploy/k8s';
const k8sFiles = renderK8s();

if (CHECK) {
  const stale = [];
  for (const [name, content] of Object.entries(k8sFiles)) {
    const path = join(K8S_DIR, name);
    if (!existsSync(path) || readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== content) stale.push(path);
  }
  const extra = existsSync(K8S_DIR) ? readdirSync(K8S_DIR).filter((f) => !(f in k8sFiles)) : [];
  if (stale.length || extra.length) {
    for (const p of stale) console.error(`✗ stale: ${p}`);
    for (const f of extra) console.error(`✗ not generated (delete or add to the generator): ${join(K8S_DIR, f)}`);
    console.error('Run: npm run deploy:gen -- --k8s-only');
    process.exit(1);
  }
  console.log(`✓ ${K8S_DIR} matches deploy/deploy.config.json (${Object.keys(k8sFiles).length} files)`);

  // Optional: render the VPS artifacts somewhere disposable, e.g. at another replica count.
  const outDir = arg('out-dir', '');
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${slug}.caddy`), renderCaddy());
    writeFileSync(join(outDir, 'compose.yaml'), renderCompose(`${slug}:check`));
    console.log(`✓ Rendered VPS artifacts at replicas=${replicas} into ${outDir}`);
  }
  process.exit(0);
}

mkdirSync(K8S_DIR, { recursive: true });
for (const [name, content] of Object.entries(k8sFiles)) writeFileSync(join(K8S_DIR, name), content);
console.log(`✓ Generated ${K8S_DIR}/ (${Object.keys(k8sFiles).length} files)`);

if (!K8S_ONLY) {
  const release = arg('release');
  const imageRef = arg('image-ref', `${slug}:${release}`);
  const outDir = 'deploy/generated';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${slug}.caddy`), renderCaddy());
  writeFileSync(join(outDir, 'compose.yaml'), renderCompose(imageRef));
  console.log(`✓ Generated ${outDir}/${slug}.caddy and ${outDir}/compose.yaml`);
  console.log(`  host=${hostname} replicas=${replicas} loopback=${loopbackPort}..${loopbackPort + replicas - 1} image=${imageRef}`);
}
