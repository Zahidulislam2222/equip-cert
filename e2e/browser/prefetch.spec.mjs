/**
 * Client-side navigation data is served (E2E pass 2026-11-25). The Next client requests segment
 * prefetches as `__next.app.dashboard.__PAGE__.txt`; `next build` writes them as
 * `__next.app/dashboard/__PAGE__.txt`. deploy/server.ts maps one to the other — without it every
 * prefetch 404s and each in-app link becomes a full page load.
 */
import { test, expect } from '@playwright/test';

test('segment prefetch files resolve through the self-host server', async ({ request }) => {
  for (const path of [
    '/app/dashboard/__next.app.dashboard.__PAGE__.txt',
    '/app/settings/__next.app.settings.__PAGE__.txt',
    '/auth/signup/__next.auth.signup.__PAGE__.txt',
    '/__next.__PAGE__.txt',
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
  // Still no way out of the export directory — neither through an encoded slash (normalised away
  // before the mapping) nor through runs of dots, which DO reach the mapping (fresh review 2026-11-25).
  for (const path of [
    '/app/__next..%2F..%2Fpackage.json.txt',
    '/app/__next.......package.json.txt',
    '/__next.app......%2E%2E.package.json.txt',
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
