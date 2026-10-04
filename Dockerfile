# Builds both servers from the locked dependency tree in npm-shrinkwrap.json.
# The default (last) stage is the stdio server for container-based MCP directories and clients.
# The hosted Streamable HTTP server for Cloud Run is the http target: docker build --target http .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json npm-shrinkwrap.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/npm-shrinkwrap.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node

# Public tools only; reads no secrets. Cloud Run sets PORT. One trusted hop assumes Cloud Run's
# front end is the only proxy appending to X-Forwarded-For; docs/HOSTED.md verifies it after deploy.
FROM runtime AS http
# Served as the host's favicon, which Claude shows next to the connector.
COPY assets/icon.png ./assets/icon.png
ENV HOST=0.0.0.0 PORT=8080 MCP_TRUST_PROXY_HOPS=1
EXPOSE 8080
ENTRYPOINT ["node", "dist/http.js"]

FROM runtime AS stdio
ENTRYPOINT ["node", "dist/index.js"]
