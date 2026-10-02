#!/bin/sh
# Creates the least-privilege role used by the API. Runs once, on first initialisation.
# ggi_app may read, insert and update; it can never DELETE rows or run DDL.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$GGI_APP_PASSWORD" <<'EOSQL'
CREATE ROLE ggi_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE ggi TO ggi_app;
GRANT USAGE ON SCHEMA public TO ggi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ggi_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO ggi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ggi_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ggi_app;
EOSQL
