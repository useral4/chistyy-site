#!/bin/sh
set -eu
: "${APP_DATABASE_PASSWORD:?Configure a separate application database password}"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$APP_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE kinava LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE kinava OWNER TO kinava;
REVOKE ALL ON DATABASE kinava FROM PUBLIC;
GRANT CONNECT ON DATABASE kinava TO kinava;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO kinava;
SQL
