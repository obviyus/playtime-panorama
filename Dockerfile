FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY server ./server
COPY templates ./templates
COPY scripts ./scripts

RUN bun run build

FROM oven/bun:1

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["bun", "dist/index.js"]
