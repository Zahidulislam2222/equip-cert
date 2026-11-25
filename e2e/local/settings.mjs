// The local suite's own fixed values, like e2e/browser/settings.mjs for the browser suite.
// Loopback only: the billing suite starts the real server bundle on this port and talks to it over
// plain HTTP because nothing leaves the machine — there is no certificate to present on 127.0.0.1.
export const BILLING_PORT = 4322;
export const BILLING_BASE_URL = `http://127.0.0.1:${BILLING_PORT}`;
