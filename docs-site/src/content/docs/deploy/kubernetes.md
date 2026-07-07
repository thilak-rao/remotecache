---
title: Kubernetes & Helm
description: 'Install the self-hosted Nx remote cache server on Kubernetes with the Helm chart: OCI install, values reference, S3 IRSA, GCS Workload Identity, probes, TLS, graceful shutdown, and Recreate upgrades.'
---

A Helm chart is published to GHCR as an OCI artifact on every release. It defaults to filesystem storage with PersistentVolumeClaims for the token database and cache. The readiness probe uses unauthenticated `GET /ready`; liveness and `helm test` use unauthenticated [`GET /health`](/deploy/docker/#health-checks).

## Install

Install a released version straight from the registry:

```sh
helm install remotecache oci://ghcr.io/thilak-rao/charts/remotecache \
  --version X.Y.Z \
  --set adminToken="$(openssl rand -hex 32)"
```

Or install from a checkout of the repository (tracks `main`):

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="$(openssl rand -hex 32)"
```

Reference an existing Secret instead of a literal token:

```sh
helm install remotecache ./charts/remotecache \
  --set existingSecret=remotecache-admin \
  --set existingSecretKey=admin-token
```

Verify a deployed release with `helm test <release>` — it runs an in-cluster pod that curls the service's `/health` endpoint.

## S3 with EKS IRSA

For S3 with EKS IRSA — no static keys, credentials resolved from the pod's IAM role:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="$(openssl rand -hex 32)" \
  --set storage.strategy=s3 \
  --set s3.bucket=my-cache-bucket \
  --set s3.region=us-east-1 \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/remotecache
```

Leave `s3.accessKeyId` and `s3.secretAccessKey` empty to use the ServiceAccount's IAM role; the server resolves credentials through the AWS provider chain. See [Storage strategies](/guides/storage-strategies/) for the full credential model.

Grant the role object read, object create, and bucket list permissions on the cache bucket. The readiness probe lists at most one object.

## GCS with GKE Workload Identity

For GCS on GKE, prefer Workload Identity instead of a service account JSON key:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="$(openssl rand -hex 32)" \
  --set storage.strategy=gcs \
  --set gcs.bucket=my-cache-bucket \
  --set gcs.projectId=my-gcp-project \
  --set serviceAccount.annotations."iam\.gke\.io/gcp-service-account"=remotecache@my-gcp-project.iam.gserviceaccount.com
```

Leave `gcs.keyFilename` and `gcs.existingSecret` empty to use Workload Identity or other ambient Google credentials. If you need explicit credentials, set one of:

- `gcs.keyFilename`: path to a mounted service account JSON file.
- `gcs.existingSecret` plus `gcs.existingSecretKey`: an existing Secret value used as `GCS_CREDENTIALS`.

Grant the service account object read, create, and list permissions on the bucket. The readiness probe lists at most one object, so it does not require bucket metadata access.

The chart never creates a Secret from a service account JSON literal. Mount key files with `extraVolumes` and `extraVolumeMounts`, or use your own wrapper chart.

## TLS

Set `tls.enabled=true` and `tls.existingSecret` to a `kubernetes.io/tls` Secret; the chart mounts it and switches the probes to HTTPS. For most deployments, terminating TLS at an ingress is simpler. See [Direct TLS](/deploy/docker/#direct-tls) for the underlying behavior.

## Rollouts

On `SIGTERM` the server drains in-flight requests before exiting, so rollouts do not cut off active cache reads or writes — no extra `preStop` hook is needed. The drain is bounded at 30 s by default (`SHUTDOWN_DRAIN_TIMEOUT_MS`); keep `terminationGracePeriodSeconds` above it. See [Scaling](#scaling) for why the chart replaces the pod (`Recreate`) rather than rolling it.

## Scaling

remotecache currently runs as a single replica: the SQLite token store is a single-writer local
database, and the chart's `data`/`cache` volumes are `ReadWriteOnce`. The chart refuses to render
`replicaCount > 1`. The Deployment uses the `Recreate` strategy by default so upgrades don't
deadlock on the RWO volumes — expect a brief gap during rollouts (Nx treats an unreachable cache
as a miss, so builds keep working). Scale vertically, or use object storage to keep artifacts off
the pod entirely.

## Security context

The container now runs with `readOnlyRootFilesystem: true` by default; `/tmp` is an `emptyDir` and all writes go to the mounted data/cache volumes. Set `securityContext.readOnlyRootFilesystem: false` if a sidecar or wrapper needs to write elsewhere.

## Key values

| Value                                                        | Purpose                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replicaCount`                                               | Pod count. Must stay at `1`; the chart refuses to render `replicaCount > 1`. See [Scaling](#scaling).                                                                 |
| `image.repository` / `image.tag`                             | Image to run; `tag` defaults to the chart `appVersion`.                                                                                                               |
| `adminToken` / `existingSecret` / `existingSecretKey`        | Admin token literal, or a reference to an existing Secret.                                                                                                            |
| `storage.strategy`                                           | `filesystem` (default), `s3`, or `gcs`.                                                                                                                               |
| `s3.*`                                                       | Bucket, region, endpoint, and credentials. Use either inline static credentials or `s3.existingSecret`, not both; leave both empty for IAM / ambient credentials.     |
| `gcs.*`                                                      | Bucket, optional project ID, and optional explicit credentials. Prefer Workload Identity on GKE; use either `gcs.keyFilename` or `gcs.existingSecret`, not both.      |
| `tls.*`                                                      | Direct-TLS toggle and the `kubernetes.io/tls` Secret.                                                                                                                 |
| `persistence.*`                                              | PVC sizing for the token DB and cache.                                                                                                                                |
| `serviceAccount.annotations`                                 | IRSA and other cloud-identity annotations.                                                                                                                            |
| `service.type` / `service.port`                              | Service exposure (`ClusterIP` by default).                                                                                                                            |
| `config.bindAddress`                                         | Listen interface; `::` for IPv6 / dual-stack.                                                                                                                         |
| `config.maxUploadBytes`                                      | Upload size cap.                                                                                                                                                      |
| `config.cacheMaxBytes` / `config.cacheTtlHours`              | Opt-in filesystem cache eviction: LRU size cap (bytes) and last-access TTL (hours). Filesystem strategy only; `config.sweepIntervalMs` tunes the sweep period.        |
| `config.verbose`                                             | Set `true` for verbose logging.                                                                                                                                       |
| `metrics.serviceMonitor.enabled`                             | Create a Prometheus Operator `ServiceMonitor` scraping `/metrics` (default `false`; requires the CRDs).                                                               |
| `podDisruptionBudget.enabled`                                | Create a `PodDisruptionBudget` (default `false`; with one replica it can block node drains — prefer tolerating the brief `Recreate` gap).                             |
| `ingress.enabled`                                            | Create an `Ingress`. For ingress-nginx set `nginx.ingress.kubernetes.io/proxy-body-size: "0"` (or ≥ your `MAX_UPLOAD_BYTES`) or large uploads get `413` at the proxy. |
| `resources`, `extraEnv`, `extraVolumes`, `extraVolumeMounts` | Standard overrides and escape hatches.                                                                                                                                |

See `charts/remotecache/values.yaml` for the full list and defaults.
