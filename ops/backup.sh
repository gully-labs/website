#!/bin/sh
# Nightly backups of everything Gully Labs keeps on the box, into the gully-backups volume.
# Runs in the `backup` compose service. Keeps 7 days. Each run writes one dated folder:
#   web-data.tgz      the site's data volume (API keys and accounts as hashes, payments, alerts, history)
#   blog-content.tgz  Ghost's content volume (images, themes, settings files)
#   blog.sql.gz       Ghost's MySQL database
#   analytics.sql.gz  Gully Analytics' Postgres database
# Restore notes are in ops/RESTORE.md. Copy the volume off the box for disaster recovery.
set -eu
KEEP_DAYS=${KEEP_DAYS:-7}
while true; do
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
  dir=/backups/$stamp
  mkdir -p "$dir"
  ok=1
  tar -czf "$dir/web-data.tgz" -C /src/web . || ok=0
  tar -czf "$dir/blog-content.tgz" -C /src/blog . || ok=0
  mysqldump -h gully-blog-db -u ghost -p"$BLOG_DB_PASSWORD" --single-transaction --no-tablespaces ghost 2>/dev/null | gzip > "$dir/blog.sql.gz" || ok=0
  PGPASSWORD="$ANALYTICS_DB_PASSWORD" pg_dump -h gully-analytics-db -U gully gully_analytics | gzip > "$dir/analytics.sql.gz" || ok=0
  [ "$ok" = 1 ] && echo "backup ok $stamp $(du -sh "$dir" | cut -f1)" || echo "backup INCOMPLETE $stamp"
  find /backups -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
  sleep 86400
done
