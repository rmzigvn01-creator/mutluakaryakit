FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci || npm install
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
COPY public ./public/
RUN npx tsc

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
