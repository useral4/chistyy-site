#!/bin/sh
set -eu
umask 077
: "${RESTIC_REPOSITORY:?Configure an external encrypted backup repository}"
: "${RESTIC_PASSWORD_FILE:?Configure the protected Restic password file}"
case "$RESTIC_REPOSITORY" in s3:*|sftp:*|b2:*|azure:*|rest:https:*) ;; *) echo "Use an off-server repository" >&2; exit 1;; esac
exec 9>/run/lock/kinavapro-backup.lock
flock -n 9 || exit 0
cd /opt/kinavapro/deploy
stage=/var/lib/kinavapro-backup/current
mkdir -p "$stage"
chmod 700 "$stage"
docker compose exec -T database pg_dump -U postgres -d kinava --format=custom > "$stage/database.dump.tmp"
mv "$stage/database.dump.tmp" "$stage/database.dump"
docker compose exec -T app tar -C /var/lib/kinavapro -cf - leads > "$stage/leads.tar.tmp"
mv "$stage/leads.tar.tmp" "$stage/leads.tar"
date -u +%FT%TZ > "$stage/created-at.txt"
git -C /opt/kinavapro rev-parse HEAD > "$stage/commit.txt"
restic backup "$stage" --tag kinavapro
docker compose exec -T app node -e 'const fs=require("node:fs"),path=require("node:path");const root=process.env.OPS_DIR;fs.writeFileSync(path.join(root,"backup.json"),JSON.stringify({completedAt:Date.now()}),{mode:0o600});'
# Retention/prune is deliberately not automatic: use independent credentials and verified restores.
