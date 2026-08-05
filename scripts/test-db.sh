#!/usr/bin/env bash
# Replays the Supabase shim, every migration and the SQL test suite against a
# throwaway PostgreSQL database. Requires a local PostgreSQL server.
#
#   PGDATABASE_TEST=lfc_test ./scripts/test-db.sh
#
# The shim in supabase/tests/00_supabase_shim.sql stands in for the auth schema
# and roles that a real Supabase project already provides.
set -euo pipefail

cd "$(dirname "$0")/.."

DB="${PGDATABASE_TEST:-lfc_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q --no-psqlrc)

if [[ -n "${PG_SUPERUSER:-}" ]]; then
  PSQL=(sudo -u "${PG_SUPERUSER}" "${PSQL[@]}")
fi

echo "==> recreating database ${DB}"
"${PSQL[@]}" -d postgres -c "drop database if exists ${DB};" -c "create database ${DB};"

echo "==> applying Supabase shim"
"${PSQL[@]}" -d "${DB}" -f supabase/tests/00_supabase_shim.sql

for migration in supabase/migrations/*.sql; do
  echo "==> applying ${migration}"
  "${PSQL[@]}" -d "${DB}" -f "${migration}"
done

echo "==> loading seed data"
"${PSQL[@]}" -d "${DB}" \
  -c "insert into auth.users (id, email) values ('99999999-0000-4000-8000-000000000001', 'seed@example.test');"
"${PSQL[@]}" -d "${DB}" -f supabase/seed.sql

echo "==> running SQL tests"
psql_output=$("${PSQL[@]}" -d "${DB}" -f supabase/tests/01_rls_and_constraints.sql 2>&1)
echo "${psql_output}"

if ! grep -q 'All database tests passed.' <<<"${psql_output}"; then
  echo "database tests did not reach the end" >&2
  exit 1
fi
