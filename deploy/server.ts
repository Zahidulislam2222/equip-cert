/**
 * Self-hosted runtime adapter for the shared Contabo VPS.
 *
 * On Vercel, `out/` is served by the platform and `api/*.ts` run as `@vercel/node`
 * functions. Neither exists on a plain Docker host, so this process provides both:
 * a static file server for the Next.js export plus a minimal, faithful
 * VercelRequest/VercelResponse shim in front of the existing handlers.
 *
 * The handlers themselves are imported UNMODIFIED — this file adapts to them, never
 * the other way round. All tunables come from `src/lib/config.ts` (Global Rule 12).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import analyzeHandler from '../api/analyze';
import dsarHandler from '../api/dsar';
import stripeWebhookHandler from '../api/webhooks/stripe';
import { serverConfig } from '../src/lib/config';

const {
  port,
  staticDir,
  maxRequestBytes,
  headersTimeoutMs,
  requestTimeoutMs,
  keepAliveTimeoutMs,
  drainDelayMs,
  shutdownGraceMs,
} = serverConfig.selfHost;
const STATIC_ROOT = resolve(process.cwd(), staticDir);

/** Set on SIGTERM. Readiness fails while it is true; liveness does not. See `shutdown`. */
let draining = false;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
};

/**
 * Media served from `public/`. Two behaviours hang off this set:
 *  - long immutable caching (these files are large and path-versioned)
 *  - HTTP Range support, without which `video.currentTime` seeking — the whole
 *    basis of scroll-scrubbed video — does not work in most browsers.
 */
const MEDIA_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v']);

/**
 * Static assets under `public/` that are worth caching but are NOT content-hashed.
 *
 * A day of caching removes a revalidation round-trip per asset per visit without stranding
 * anyone on a stale build for long. `immutable` would be wrong here: these filenames are
 * stable across deploys, so a changed poster would never be picked up.
 */
const CACHEABLE_ASSET_EXTENSIONS = new Set([
  '.webp', '.avif', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2',
]);

/**
 * Routes that must receive the RAW request body.
 *
 * Stripe's `constructEvent` verifies a signature over the exact bytes sent. Handing it a
 * re-serialised object silently breaks every webhook, so these paths are never JSON-parsed.
 */
const RAW_BODY_ROUTES = new Set(['/api/webhooks/stripe']);

/**
 * The API surface, as a table rather than a chain of `if (pathname === ...)`.
 *
 * On Vercel every file under `api/` is a route by existence, so adding one is adding a file.
 * Here it has to be declared, and a chain of equality checks meant declaring it in two places —
 * the dispatch condition and the handler selection — with nothing to notice when only one of
 * them was updated. A table has exactly one place to add a route and one place to forget it.
 *
 * Everything not in this map that starts with /api/ is a genuine 404, never the SPA shell.
 */
type ApiHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

const API_ROUTES = new Map<string, ApiHandler>([
  ['/api/analyze', analyzeHandler],
  ['/api/dsar', dsarHandler],
  ['/api/webhooks/stripe', stripeWebhookHandler],
]);

/** Read the request body with a hard byte ceiling, so a large upload cannot exhaust memory. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxRequestBytes) {
        rejectPromise(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', rejectPromise);
  });
}

/** Add the handful of Vercel response helpers the handlers actually call. */
function decorateResponse(res: ServerResponse): VercelResponse {
  const vres = res as unknown as VercelResponse;

  vres.status = (statusCode: number) => {
    res.statusCode = statusCode;
    return vres;
  };

  vres.json = (body: unknown) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return vres;
  };

  vres.send = (body: unknown) => {
    if (body === null || body === undefined) {
      res.end();
    } else if (Buffer.isBuffer(body) || typeof body === 'string') {
      res.end(body);
    } else {
      vres.json(body);
    }
    return vres;
  };

  vres.redirect = (statusOrUrl: number | string, maybeUrl?: string) => {
    const statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
    const location = typeof statusOrUrl === 'number' ? (maybeUrl as string) : statusOrUrl;
    res.statusCode = statusCode;
    res.setHeader('Location', location);
    res.end();
    return vres;
  };

  return vres;
}

/** Build the VercelRequest shape: parsed `query`, plus `body` per the route's needs. */
async function decorateRequest(
  req: IncomingMessage,
  pathname: string,
  searchParams: URLSearchParams
): Promise<VercelRequest> {
  const vreq = req as unknown as VercelRequest;

  const query: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  vreq.query = query;
  vreq.cookies = {};

  if (req.method === 'GET' || req.method === 'HEAD') {
    vreq.body = undefined;
    return vreq;
  }

  const raw = await readBody(req);

  if (RAW_BODY_ROUTES.has(pathname)) {
    vreq.body = raw;
    return vreq;
  }

  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (raw.length === 0) {
    vreq.body = undefined;
  } else if (contentType.includes('application/json')) {
    try {
      vreq.body = JSON.parse(raw.toString('utf8'));
    } catch {
      // Mirror Vercel: an unparseable JSON body surfaces as undefined, and the
      // handler's own schema validation produces the 400.
      vreq.body = undefined;
    }
  } else {
    vreq.body = raw.toString('utf8');
  }

  return vreq;
}

/**
 * Resolve a URL path to a file inside STATIC_ROOT.
 *
 * Next's export writes `/app/dashboard` as `out/app/dashboard.html`, so bare paths are
 * retried with `.html` and then `/index.html`. Returns null on traversal attempts.
 */
async function resolveStaticFile(pathname: string): Promise<string | null> {
  const decoded = decodeURIComponent(pathname);
  const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const base = join(STATIC_ROOT, safe);

  if (base !== STATIC_ROOT && !base.startsWith(STATIC_ROOT + sep)) return null;

  const candidates =
    decoded.endsWith('/') || decoded === ''
      ? [join(base, 'index.html')]
      : [base, `${base}.html`, join(base, 'index.html')];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * Parse a single-range `Range: bytes=start-end` header against a known file size.
 *
 * Only one range is honoured. Multi-range requests fall back to the full body, which is
 * a legal response and is what media elements actually use in practice.
 */
function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix form: the last N bytes.
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : Number.parseInt(rawEnd, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  if (start > end || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

async function sendStatic(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  statusCode: number,
  headOnly: boolean
) {
  const ext = extname(filePath).toLowerCase();
  const isVersionedMedia = MEDIA_EXTENSIONS.has(ext);

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    res.statusCode = 404;
    res.end();
    return;
  }

  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');

  // Content-hashed build output is immutable; HTML must always be revalidated so a
  // redeploy is picked up immediately.
  //
  // Scroll-scrubbed media is the third case. Those files are tens of megabytes and are
  // versioned by their own path, so serving them `no-cache` would re-download the whole
  // hero on every visit — by far the largest bandwidth cost on a shared host.
  const isHashedBuildOutput = filePath.includes(`${sep}_next${sep}static${sep}`);
  let cacheControl: string;
  if (isHashedBuildOutput || isVersionedMedia) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else if (CACHEABLE_ASSET_EXTENSIONS.has(ext)) {
    cacheControl = 'public, max-age=86400';
  } else {
    cacheControl = 'no-cache';
  }
  res.setHeader('Cache-Control', cacheControl);

  // Seeking a <video> requires byte ranges. Advertise support on media only — the rest of
  // the export is small enough that partial responses buy nothing.
  if (isVersionedMedia) res.setHeader('Accept-Ranges', 'bytes');

  const range = isVersionedMedia && statusCode === 200 ? parseRange(req.headers.range, size) : null;

  if (range === 'invalid') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(length));
    if (headOnly) {
      res.end();
      return;
    }
    createReadStream(filePath, { start: range.start, end: range.end })
      .on('error', () => res.destroy())
      .pipe(res);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Length', String(size));
  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

// connectionsCheckingInterval is how often Node actually ENFORCES headersTimeout and
// requestTimeout. Its default is 30s, so a 15s headersTimeout was really "15-45s": a slow-headers
// client held its socket for over 8s against a 2s timeout in tests/server_drain_test.mjs.
// A quarter of the tighter timeout bounds the overshoot to 25%; derived, not a separate setting.
const connectionsCheckingInterval = Math.max(250, Math.floor(Math.min(headersTimeoutMs, requestTimeoutMs) / 4));

const server = createServer({ connectionsCheckingInterval }, async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  try {
    // While draining, tell keep-alive clients (the proxy included) not to reuse this socket, so
    // connections migrate to healthy replicas instead of queueing on one that is leaving.
    if (draining) res.setHeader('Connection', 'close');

    // LIVENESS: is the process able to serve at all? Restarting on a failure here is correct.
    // Deliberately cheap and dependency-free — a liveness probe that checks the database turns
    // a database blip into every replica being restarted at once.
    if (pathname === '/healthz') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end('ok\n');
      return;
    }

    // READINESS: should the load balancer send this replica new traffic? False while draining,
    // which is what makes a rolling deploy lose no requests. Distinct from liveness on purpose:
    // a draining replica is healthy and must NOT be restarted.
    if (pathname === '/readyz') {
      res.statusCode = draining ? 503 : 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(draining ? 'draining\n' : 'ready\n');
      return;
    }

    const apiHandler = API_ROUTES.get(pathname);
    if (apiHandler) {
      // API responses are per-caller (auth, rate-limit state, DSAR receipts). No shared cache —
      // the proxy, a CDN or a browser — may ever store one. A handler may still override it.
      res.setHeader('Cache-Control', 'no-store');
      let vreq: VercelRequest;
      try {
        vreq = await decorateRequest(req, pathname, url.searchParams);
      } catch (err) {
        if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
        throw err;
      }
      const vres = decorateResponse(res);
      await apiHandler(vreq, vres);
      if (!res.writableEnded) res.end();
      return;
    }

    // Any other /api/* path is a genuine 404, never the SPA shell.
    if (pathname.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end();
      return;
    }

    const filePath = await resolveStaticFile(pathname);
    if (filePath) {
      await sendStatic(req, res, filePath, 200, method === 'HEAD');
      return;
    }

    const notFound = await resolveStaticFile('/404.html');
    if (notFound) {
      await sendStatic(req, res, notFound, 404, method === 'HEAD');
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found\n');
  } catch (error) {
    // Never leak internals to the client; the detail goes to the container log only.
    console.error('Unhandled request error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// Timeouts. Node's defaults leave headersTimeout at 60s and keepAliveTimeout at 5s — the first is
// generous to a slowloris client, the second is SHORTER than any sensible proxy idle timeout and
// produces intermittent 502s behind a load balancer that reuses the socket just as it closes.
server.headersTimeout = headersTimeoutMs;
server.requestTimeout = requestTimeoutMs;
server.keepAliveTimeout = keepAliveTimeoutMs;

server.listen(port, () => {
  console.log(`EquipCert self-host runtime listening on ${port}, serving ${STATIC_ROOT}`);
});

/**
 * Graceful drain. Zero-downtime rolling deploys depend on the ORDER of these steps:
 *
 *   1. Readiness fails first (/readyz -> 503) while the listener stays open, for drainDelayMs.
 *      The load balancer's health check sees it and stops sending NEW requests here. Requests
 *      that arrive during the window — routed before the check noticed — still succeed.
 *   2. The listener closes. Idle keep-alive sockets are closed immediately; sockets with a
 *      request in flight are allowed to finish.
 *   3. A hard deadline destroys whatever is still open, so a hung upstream call can never stop
 *      a deploy. The exit code says which way it went.
 *
 * The previous version was step 2 alone: `server.close()` with no readiness signal and no
 * deadline. The proxy kept routing to a closing process, and one slow AI call could hold the
 * container until the orchestrator SIGKILLed it mid-response.
 */
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  draining = true;
  console.log(`${signal} received: failing readiness for ${drainDelayMs}ms, then draining`);

  setTimeout(() => {
    server.close(() => {
      console.log('Drained cleanly');
      process.exit(0);
    });
    server.closeIdleConnections();

    setTimeout(() => {
      console.error(`Shutdown grace of ${shutdownGraceMs}ms exceeded; destroying open connections`);
      server.closeAllConnections();
      process.exit(1);
    }, shutdownGraceMs).unref();
  }, drainDelayMs).unref();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => shutdown(signal));
}
