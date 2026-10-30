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

FROM runtime AS http
COPY assets/icon.png ./assets/icon.png
ENV HOST=0.0.0.0 PORT=8080 MCP_TRUST_PROXY_HOPS=1
EXPOSE 8080
ENTRYPOINT ["node", "dist/http.js"]

FROM runtime AS stdio
ENTRYPOINT ["node", "dist/index.js"]
