// Exact request bytes for handlers that verify a signature over them (DEF-008).
//
// Stripe signs the bytes it sent. Anything that parses the body and serialises it again —
// different whitespace, key order, unicode escaping — produces a body the signature does not
// cover, and every webhook is rejected. The two delivery targets hand the handler the body in
// different shapes, and neither shape can be read through `req.body` safely:
//
// - Vercel: `req.body` is a lazy getter that JSON-parses on first access. `bodyParser: false` is
//   a Next.js API-route option and does nothing for a plain function. The runtime buffers the
//   body and replays it into the stream (`restoreBody` in @vercel/node), so the stream is still
//   readable — as long as the getter is never touched.
// - Self-host (deploy/server.ts): the adapter consumes the stream under its byte ceiling and
//   stores the untouched Buffer as a plain data property for the routes in RAW_BODY_ROUTES.
//
// So the property DESCRIPTOR decides, never the value: reading the value is what triggers the
// parse this function exists to avoid.

import type { IncomingMessage } from 'node:http';

export class RawBodyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawBodyUnavailableError';
  }
}

export async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const descriptor = Object.getOwnPropertyDescriptor(req, 'body');

  if (descriptor && 'value' in descriptor && descriptor.value !== undefined) {
    const value: unknown = descriptor.value;
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return Buffer.from(value, 'utf8');
    // Something upstream already parsed it. Re-serialising would "work" in a test and fail
    // against every real signature, so refuse instead.
    throw new RawBodyUnavailableError('Request body was parsed before signature verification');
  }

  // Listeners, not `for await`: Vercel's replay redirects only the 'data' and 'end' events to
  // the buffered copy. An async iterator waits on 'readable' from the original, already-drained
  // stream and would never resolve.
  //
  // No `readableEnded` short-circuit, deliberately: under that same replay the ORIGINAL stream
  // reports ended while the replay still holds every byte, so the check would return an empty
  // body on Vercel. Every adapter that consumes the stream must therefore leave the bytes as a
  // data property — deploy/server.ts does, for every POST, via RAW_BODY_ROUTES.
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
