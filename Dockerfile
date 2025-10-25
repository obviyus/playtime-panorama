FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY server ./server
COPY templates ./templates

RUN bun run build

FROM oven/bun:1

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["bun", "dist/index.js"]
