import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deployment artifacts emitted by `npm run build:server` / `npm run deploy:gen`.
    // The esbuild bundle is vendored third-party code; linting it is meaningless noise.
    "deploy/generated/**",
  ]),
]);

export default eslintConfig;
