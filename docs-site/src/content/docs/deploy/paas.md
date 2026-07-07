---
title: Railway, Render, and Fly.io
description: Deploy the self-hosted Nx remote cache server on Railway, Render, or Fly.io with the repo-local templates.
---

The repository includes starter config for three app platforms:

| Platform | File           | What it does                                                                                                    |
| -------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Railway  | `railway.json` | Builds the root Dockerfile, checks `/health`, and requires a volume at `/app/data`.                             |
| Render   | `render.yaml`  | Deploys `ghcr.io/thilak-rao/remotecache:latest`, creates one web service, and attaches one disk at `/app/data`. |
| Fly.io   | `fly.toml`     | Deploys the GHCR image, exposes port `3000`, checks `/health`, and mounts a Fly volume at `/app/data`.          |

These templates target a single instance with filesystem storage. That is the simplest way to try the server on a PaaS. For larger cache artifacts or stricter bucket lifecycle controls, use S3 storage instead of a platform-local volume. S3 stores cache artifacts only; the token database still needs persistent storage unless you manage tokens some other way.

The Render and Fly.io templates use `ghcr.io/thilak-rao/remotecache:latest` as a starter default. Before production, replace `latest` with a pinned release tag such as `:X.Y.Z` or `:X.Y`.

## Shared settings

Set `ADMIN_TOKEN` as a secret or protected environment variable before the first deploy. It must be at least 16 characters. Generate one locally:

```sh
openssl rand -hex 32
```

Configure each platform so mutable files stay under `/app/data`. Render and Fly.io declare these settings in the template. Railway requires service variables in the dashboard or CLI because `railway.json` covers build and deploy settings, not environment variables.

| Variable         | Value                     |
| ---------------- | ------------------------- |
| `CACHE_DIR`      | `/app/data/cache`         |
| `TOKENS_DB_PATH` | `/app/data/tokens.sqlite` |

Only trusted jobs should get `full` tokens. Pull requests from forks and other untrusted CI contexts should use `readonly` tokens so they can read existing cache entries but cannot upload new artifacts.

## Railway

`railway.json` uses Railway config-as-code for the Dockerfile build, restart policy, `/health` check, and shutdown drain. It also sets `requiredMountPath` to `/app/data`, so a deploy without a volume fails instead of silently using ephemeral storage.

Configure Railway volumes and service variables in the dashboard or CLI, not fully in `railway.json`.

1. Create a Railway service from this repository.
2. Set `ADMIN_TOKEN`, `CACHE_DIR=/app/data/cache`, and `TOKENS_DB_PATH=/app/data/tokens.sqlite`.
3. Add one volume mounted at `/app/data`.
4. Generate a public or private domain for the service.

Verify the local config after installing the Railway CLI:

```sh
railway up --detach
railway logs
curl -fsS https://<your-service>.up.railway.app/health
```

## Render

`render.yaml` is a Render Blueprint. It creates one web service from the published GHCR image, prompts for `ADMIN_TOKEN`, sets `PORT=3000`, sets Render's shutdown delay to 35 seconds, and attaches a persistent disk at `/app/data`.

Use the Blueprint flow in Render and point it at this repository. The default `starter` plan is intentionally small; raise the plan and disk size if your cache grows or your uploads are large. Render services with persistent disks do not use zero-downtime deploys, so expect a brief restart during redeploys.

Validate the Blueprint after installing the Render CLI:

```sh
render blueprints validate render.yaml
```

After deploy, verify health:

```sh
curl -fsS https://<your-render-service>.onrender.com/health
```

## Fly.io

`fly.toml` deploys the published GHCR image directly. Change the `app` name before creating the app, then create one volume named `remotecache_data` in the same region as `primary_region`.

```sh
fly apps create <your-app-name>
fly volumes create remotecache_data --region ord --size 10
fly secrets set ADMIN_TOKEN="$(openssl rand -hex 32)"
fly deploy
```

If you change `primary_region`, create the volume in the same region. Fly volumes are tied to a region and machine placement.

Validate the config after installing flyctl:

```sh
fly config validate
```

After deploy, verify health:

```sh
curl -fsS https://<your-app-name>.fly.dev/health
```

## When to use S3 instead

Use S3-compatible storage when:

- the cache is too large for one platform disk
- you need backups, lifecycle policies, or bucket-level retention
- you want the app instance to be disposable
- you prefer object-store controls over platform-local volume behavior

Set `STORAGE_STRATEGY=s3` and provide the S3 variables from [Storage strategies](/guides/storage-strategies/). Keep the token DB on a persistent disk unless you manage tokens some other way.

## Security notes

`/health` is unauthenticated and safe for platform health checks. `/metrics` is also unauthenticated but should not be public; expose it only to your collector.

These PaaS templates do not change the security model. The CREEP mitigation is operational: trusted pipelines get `full` tokens, untrusted pipelines get `readonly` tokens, and writes are append-only. If you need cryptographic artifact verification, compare the trade-off with [Nx Cloud](/compare/nx-cloud/).
