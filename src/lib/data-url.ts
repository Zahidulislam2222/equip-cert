/**
 * Decode a base64 `data:` URL (the signature pad's PNG export) into a Blob WITHOUT `fetch()`.
 *
 * `fetch(dataUrl)` is the common idiom, and it fails in production: the Content-Security-Policy's
 * `connect-src` (vercel.json, mirrored into the Caddy site) does not list `data:`, and browsers
 * apply `connect-src` to fetches of data URLs. Every signed submission on a paid plan would have
 * thrown before saving. Adding `data:` to connect-src would widen the policy for every caller;
 * decoding locally needs no network permission at all.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error('Not a base64 data URL.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1].toLowerCase() });
}
