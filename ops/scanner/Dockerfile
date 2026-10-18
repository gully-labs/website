# gully-scanner: the static-analysis worker for Gully Security (server/security). Runs untrusted code
# through Slither, Aderyn, Foundry (build only) and optionally Semgrep. See server/security/README.md.
#
# Build (on a box with 15 GB+ free; run ./preflight.sh first):
#   docker build -t gully-scanner:latest ops/scanner
#   docker build --build-arg WITH_SEMGREP=1 -t gully-scanner:latest ops/scanner     (adds ~400 MB)
#
# Everything the tools need at run time is downloaded HERE, at build time: the container runs with no
# outbound network, so solc versions, forge-std and Semgrep rules are baked in.

FROM node:24-bookworm-slim AS node

FROM python:3.12-slim-bookworm
ARG SLITHER_VERSION=0.11.6
ARG SOLC_SELECT_VERSION=1.1.0
ARG FOUNDRY_VERSION=v1.8.1
ARG ADERYN_VERSION=0.6.8
ARG FORGE_STD_VERSION=v1.9.7
ARG SOLC_VERSIONS="0.8.30 0.8.28 0.8.27 0.8.26 0.8.24 0.8.23 0.8.22 0.8.21 0.8.20 0.8.19 0.8.18 0.8.17 0.8.15 0.8.13 0.8.10 0.8.4 0.8.0 0.7.6 0.6.12"
ARG WITH_SEMGREP=0
ARG SEMGREP_VERSION=1.100.0

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/scanner PATH=/home/scanner/.foundry/bin:/usr/local/bin:/usr/bin:/bin

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/scanner --shell /usr/sbin/nologin scanner

# Node (worker runtime, and npm for the Aderyn package) from the official image.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

RUN pip install "slither-analyzer==${SLITHER_VERSION}" "solc-select==${SOLC_SELECT_VERSION}" \
 && if [ "$WITH_SEMGREP" = "1" ]; then pip install "semgrep==${SEMGREP_VERSION}"; fi

RUN npm install -g "@cyfrin/aderyn@${ADERYN_VERSION}" && npm cache clean --force

# Rules for Semgrep, fetched now because the container has no network later.
RUN mkdir -p /opt/semgrep-rules && if [ "$WITH_SEMGREP" = "1" ]; then \
      curl -fsSL https://semgrep.dev/c/p/smart-contracts -o /opt/semgrep-rules/solidity.yaml \
   && curl -fsSL https://semgrep.dev/c/p/owasp-top-ten -o /opt/semgrep-rules/web.yaml; \
    else rmdir /opt/semgrep-rules; fi

RUN git clone --depth 1 --branch "${FORGE_STD_VERSION}" https://github.com/foundry-rs/forge-std /opt/forge-std \
 && rm -rf /opt/forge-std/.git

USER scanner
WORKDIR /home/scanner
RUN curl -fsSL https://foundry.paradigm.xyz | bash \
 && /home/scanner/.foundry/bin/foundryup --install "${FOUNDRY_VERSION}" \
 && rm -rf /home/scanner/.foundry/cache
RUN for v in $SOLC_VERSIONS; do solc-select install "$v"; done \
 && solc-select use "$(echo $SOLC_VERSIONS | cut -d' ' -f1)" \
 && mkdir -p /home/scanner/.svm \
 && for v in $SOLC_VERSIONS; do mkdir -p "/home/scanner/.svm/$v" && cp "/home/scanner/.solc-select/artifacts/solc-$v/solc-$v" "/home/scanner/.svm/$v/solc-$v"; done

COPY --chown=root:root worker.mjs /app/worker.mjs

ENV PORT=8090 HOST=0.0.0.0 SCANNER_WORK=/work TOOL_TIMEOUT_SEC=300 \
    SOLC_ARTIFACTS=/home/scanner/.solc-select/artifacts FORGE_STD_DIR=/opt/forge-std SEMGREP_RULES_DIR=/opt/semgrep-rules
EXPOSE 8090
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8090/health',{headers:{'x-scanner-token':process.env.SCANNER_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/worker.mjs"]
