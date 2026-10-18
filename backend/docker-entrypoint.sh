#!/bin/sh
set -e

# Only the API container prepares the database. The worker just starts (it waits for the API to be healthy).
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy
  echo "Seeding demo data if the database is empty..."
  npx tsx prisma/seed.ts --if-empty
fi

exec "$@"
