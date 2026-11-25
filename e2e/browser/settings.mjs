// The browser suite's own fixed values. Loopback only; 4321 is in supabase/config.toml's
// additional_redirect_urls so the local email-confirmation link may return here.
export const BROWSER_PORT = 4321;
export const BASE_URL = `http://localhost:${BROWSER_PORT}`;
export const MAILPIT_URL = 'http://127.0.0.1:54324';
