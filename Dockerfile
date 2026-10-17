# Build the site, then run it with a dependency-free Node server.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# .env is not copied (.dockerignore); only these public build-time values come in, from compose.
ARG VITE_LIFI_INTEGRATOR=
ARG VITE_LIFI_FEE=
ARG VITE_WALLETCONNECT_PROJECT_ID=
ARG VITE_JUPITER_FEE_BPS=
ARG VITE_JUPITER_FEE_ACCOUNT=
ENV VITE_LIFI_INTEGRATOR=$VITE_LIFI_INTEGRATOR VITE_LIFI_FEE=$VITE_LIFI_FEE VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID VITE_JUPITER_FEE_BPS=$VITE_JUPITER_FEE_BPS VITE_JUPITER_FEE_ACCOUNT=$VITE_JUPITER_FEE_ACCOUNT
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DIST_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY server/*.mjs ./
COPY server/vendor ./vendor
# From the build stage: `npm run build` regenerates data/ask-index.json (Gully Ask) before the bundle.
COPY --from=build /app/server/data ./data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
