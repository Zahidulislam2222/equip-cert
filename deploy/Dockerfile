# EquipCert self-host runtime image.
#
# Deliberately COPY-only. The Next.js static export and the server bundle are both
# produced on the developer PC (`npm run build` + `npm run build:server`), so this image
# runs no npm install and needs no node_modules — INFRASTRUCTURE.md asks that builds stay
# off the shared VPS wherever practical, and a bundle-only image keeps the build to a
# few seconds with no network access.
#
# Base pinned by digest for reproducible rebuilds. Re-resolve with:
#   docker image inspect node:22-alpine --format '{{index .RepoDigests 0}}'
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

ENV NODE_ENV=production
WORKDIR /app

# Static export first: it is the layer most likely to change between releases.
COPY out ./out
COPY server.cjs ./server.cjs

# The upstream node image ships an unprivileged `node` user (uid 1000).
USER node

EXPOSE 8080
CMD ["node", "server.cjs"]
