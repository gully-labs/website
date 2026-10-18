# Build the site, then run it with a dependency-free Node server (plus resvg's WebAssembly build for
# blog share images, copied in below from the build stage).
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
# Gully Security's scan engine (server/security-*.mjs import it as ./security/index.mjs).
COPY server/security ./security
# Blog share images (og.mjs): the post banner's drawing code, the brand fonts it sets type in, and the
# SVG rasteriser (resvg, WebAssembly, no dependencies of its own). Nothing else from node_modules.
COPY ghost/theme/gully/assets/js/banner.js ./og/banner.cjs
COPY --from=build /app/node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-800-normal.woff /app/node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-ext-800-normal.woff ./og/fonts/
COPY --from=build /app/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff /app/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-500-normal.woff ./og/fonts/
COPY --from=build /app/node_modules/@resvg/resvg-wasm/package.json /app/node_modules/@resvg/resvg-wasm/index.js /app/node_modules/@resvg/resvg-wasm/index_bg.wasm ./node_modules/@resvg/resvg-wasm/
# From the build stage: `npm run build` regenerates data/ask-index.json (Gully Ask) before the bundle.
COPY --from=build /app/server/data ./data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
