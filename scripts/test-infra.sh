#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TEST_DATABASE_USERNAME="${TEST_DATABASE_USERNAME:-test}"
TEST_DATABASE_PASSWORD="${TEST_DATABASE_PASSWORD:-test}"
TEST_DATABASE_NAME="${TEST_DATABASE_NAME:-payments_test}"

if [ ! -f .env ]; then
  echo "scripts/test-infra.sh: .env not found — run 'cp .env.example .env' first" >&2
  exit 1
fi

docker compose --profile test up -d --wait

docker compose exec -T payments-service-postgresql \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres --quiet' <<SQL
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L CREATEDB', '${TEST_DATABASE_USERNAME}', '${TEST_DATABASE_PASSWORD}')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${TEST_DATABASE_USERNAME}')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', '${TEST_DATABASE_NAME}', '${TEST_DATABASE_USERNAME}')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${TEST_DATABASE_NAME}')
\gexec
SQL
