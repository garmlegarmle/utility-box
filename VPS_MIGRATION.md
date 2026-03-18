# Utility Box VPS Migration Plan

## Objective

Move `Utility Box` away from Cloudflare Pages hosting into a VPS-based deployment that can coexist with `HSE_PWA` on the same server without shared state or port collisions.

## Recommended operating model

- Cloudflare stays in front for DNS, TLS, WAF, and cache
- `Utility Box` runs as its own deployment root under `/opt/utility-box`
- `HSE_PWA` remains isolated in `/opt/hse`
- Utility Box uses its own Docker project, network, env, logs, database, and upload volume

## Migration phases

### Phase 1

Move the frontend and API onto the VPS.

- Deploy the React/Vite frontend to the VPS on host port `3100`
- Run a dedicated `utility-box-api` Node service inside the same Compose project
- Run a dedicated `utility-box-db` PostgreSQL service inside the same Compose project
- Use host Nginx to route `www.ga-ml.com` to the frontend container
- Point the frontend `/api` proxy to `http://utility-box-api:8200`

### Phase 2

Import runtime content into PostgreSQL and decommission Cloudflare runtime services.

- Import existing posts/tags/media metadata from the current runtime source
- Verify admin login, CRUD, uploads, and image delivery against the VPS API
- Retire old runtime services once the VPS API is the single source of truth

## Non-negotiable separation from HSE

- Do not reuse `/opt/hse`
- Do not reuse HSE Docker networks or compose project name
- Do not reuse HSE database or database user
- Do not reuse HSE upload paths
- Do not publish Utility Box directly on public high ports

## Reserved names

- Project root: `/opt/utility-box`
- Compose project: `utility-box`
- Container prefix: `utility-box-*`
- Network: `utility_box_net`
- Web host port: `3100`
- API container port: `8200`

## Required server work

1. Create `/opt/utility-box/*` directories
2. Clone the repo into `/opt/utility-box/app`
3. Add env files at:
   - `deploy/vps/env/utility-box.db.env`
   - `deploy/vps/env/utility-box.api.env`
   - `deploy/vps/env/utility-box.web.env`
4. Run `deploy/vps/scripts/preflight-utility-box.sh`
5. Deploy with `deploy/vps/scripts/deploy-utility-box.sh`
6. Add the provided Nginx server block
7. Change Cloudflare DNS from Pages to the VPS when verified

## Why this is safe

- HSE stays untouched
- Utility Box has its own Docker project, database volume, and upload volume
- The web service is the only host-exposed Utility Box port
- Rollback is just DNS + container stop

## What still needs implementation later

- Published/draft content import into PostgreSQL
- Optional object-storage offload if uploads outgrow the VPS volume
