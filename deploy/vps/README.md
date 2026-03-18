# Utility Box VPS Deployment

This directory documents the VPS deployment for `Utility Box` without colliding with `HSE_PWA`.

## Current intent

- Run `Utility Box` as a separate Docker project on the same VPS.
- Keep Cloudflare only for DNS / TLS / WAF / CDN.
- Move the frontend and API to the VPS.
- Store Utility Box content in its own PostgreSQL container and upload volume.

## Isolation rules

Never place this project under `/opt/hse`.

Use this layout instead:

```text
/opt/hse
/opt/utility-box
/opt/utility-box/app
/opt/utility-box/backups
/opt/utility-box/storage
```

Keep these things separate from HSE:

- Docker project name: `utility-box`
- Docker network: `utility_box_net`
- Web port: `3100` (host-level, but keep it blocked externally with UFW)
- API port: internal only, `utility-box-api:8200`
- DB: separate PostgreSQL container/database/user
- Uploads: `/opt/utility-box/storage/uploads` via Docker volume

## What is ready now

This repo now includes:

- `Dockerfile.web`: builds the Vite frontend and serves it with Nginx
- `Dockerfile.api`: runs the VPS-native Node/PostgreSQL API
- `docker-compose.utility-box.yml`: isolated `db + api + web` stack bound to host port `3100`
- `nginx/default.conf.template`: SPA serving + `/api` reverse proxy
- `nginx/utility-box.host.nginx.conf`: host-level Nginx server block for the domain
- `scripts/preflight-utility-box.sh`: checks path, port, Docker, and compose validity
- `scripts/deploy-utility-box.sh`: pull + rebuild + restart

## Deployment flow

1. On the VPS, create directories:

```bash
sudo mkdir -p /opt/utility-box/app /opt/utility-box/backups /opt/utility-box/storage
sudo chown -R $USER:$USER /opt/utility-box
```

2. Clone the repo into `/opt/utility-box/app`.

3. Create the env files from the examples:

```bash
cp /opt/utility-box/app/deploy/vps/env/utility-box.db.env.example \
   /opt/utility-box/app/deploy/vps/env/utility-box.db.env
cp /opt/utility-box/app/deploy/vps/env/utility-box.api.env.example \
   /opt/utility-box/app/deploy/vps/env/utility-box.api.env
cp /opt/utility-box/app/deploy/vps/env/utility-box.web.env.example \
   /opt/utility-box/app/deploy/vps/env/utility-box.web.env
```

4. Set matching database credentials in both:

```text
deploy/vps/env/utility-box.db.env
deploy/vps/env/utility-box.api.env
```

5. Keep the web upstream local:

```text
API_UPSTREAM=http://utility-box-api:8200
```

Set local admin credentials in `deploy/vps/env/utility-box.api.env`:

```text
ADMIN_LOGIN_USER=your-admin-id
ADMIN_LOGIN_PASSWORD=strong-password
```

6. Run preflight:

```bash
sh /opt/utility-box/app/deploy/vps/scripts/preflight-utility-box.sh /opt/utility-box
```

7. Deploy:

```bash
sh /opt/utility-box/app/deploy/vps/scripts/deploy-utility-box.sh /opt/utility-box
```

8. If you need to bootstrap from an existing public API, import published content:

```bash
cd /opt/utility-box/app/server
SOURCE_API_BASE=https://www.ga-ml.com/api npm run import:published
```

9. Install the host-level Nginx snippet from `nginx/utility-box.host.nginx.conf`.

   If the VPS already terminates TLS on port 443, merge the same proxy rules into the
   existing HTTPS vhost instead of using the plain HTTP example as-is.

10. Point `www.ga-ml.com` to the VPS in Cloudflare once the local proxy is confirmed.

## Rollback

If the VPS cutover goes wrong:

1. Leave HSE untouched
2. Stop the Utility Box compose project
3. Point Cloudflare back to the previous frontend origin
