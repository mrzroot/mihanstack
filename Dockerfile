# MihanStack · The local development cloud for Iranian services
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json README.md LICENSE ./
USER node
EXPOSE 8585
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8585/_mihan/health || exit 1
# Mount your config at /app/mihanstack.yml (optional).
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["start", "--host", "0.0.0.0", "--port", "8585"]
