FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace @pankti/web --include-workspace-root --no-audit --no-fund
COPY apps/web apps/web
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --workspaces=false --omit=dev --no-audit --no-fund
COPY server server
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 4100
CMD ["node", "server/index.mjs"]
