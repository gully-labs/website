# Gully AI sidecar: CPU embeddings + reranker. Memory-capped at run time (compose: mem_limit 1g, cpus 2).
# Weights are downloaded into /models on first start (a named volume), never baked into the image or git.
FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip MODEL_DIR=/models HOST=0.0.0.0 PORT=8801
USER node
CMD ["node", "server.mjs"]
