# Restoring a Gully Labs backup

Backups are dated folders in the `gully-backups` volume (`docker run --rm -v gully-backups:/b alpine ls /b`).
Stop only the service you restore; never touch containers outside project `gully`.

- **Site data**: `docker compose stop web`, then extract `web-data.tgz` into the `gully-web-data` volume
  (`docker run --rm -v gully-web-data:/d -v gully-backups:/b alpine sh -c 'cd /d && tar -xzf /b/<stamp>/web-data.tgz'`),
  then `docker compose up -d web`.
- **Blog**: stop `blog`; restore `blog-content.tgz` into `gully-blog-content` the same way; load the database with
  `gunzip -c blog.sql.gz | docker exec -i gully-blog-db sh -c 'mysql -u ghost -p"$MYSQL_PASSWORD" ghost'`; start `blog`.
- **Analytics**: stop `analytics`; `gunzip -c analytics.sql.gz | docker exec -i gully-analytics-db psql -U gully gully_analytics`
  (into an empty database); start `analytics`.

Backups live on the same disk as the data, so they protect against mistakes, not against losing the server.
Copy the folders off the box (S3, R2 or another host) for that.
