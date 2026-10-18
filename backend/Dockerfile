FROM node:22-bookworm-slim

# Prisma's database engine needs OpenSSL.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
# Generating the client does not connect to a database; the URL only has to exist.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

COPY src ./src
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4000

# The API runs the migrations and seeds an empty database, then starts. The worker overrides CMD.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]
