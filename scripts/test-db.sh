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

run_suite() {
  local file="$1"
  local sentinel="$2"

  echo "==> running ${file}"
  local output
  output=$("${PSQL[@]}" -d "${DB}" -f "${file}" 2>&1)
  echo "${output}"

  if ! grep -q "${sentinel}" <<<"${output}"; then
    echo "database tests in ${file} did not reach the end" >&2
    exit 1
  fi
}

run_suite supabase/tests/01_rls_and_constraints.sql 'All database tests passed.'
run_suite supabase/tests/02_phase2_follow_up_engine.sql 'All Phase 2 database tests passed.'
run_suite supabase/tests/03_phase3_intake_and_notifications.sql 'All Phase 3 database tests passed.'
