---
title: Kubernetes & Helm
description: Install the self-hosted Nx remote cache server on Kubernetes with the Helm chart — OCI install, values reference, S3 IRSA, probes, TLS, and graceful rolling updates.
---

A Helm chart is published to GHCR as an OCI artifact on every release. It defaults to filesystem storage with PersistentVolumeClaims for the token database and cache, and points its probes at the unauthenticated [`/health`](/deploy/docker/#health-checks) endpoint.

## Install

Install a released version straight from the registry:

```sh
helm install remotecache oci://ghcr.io/thilak-rao/charts/remotecache \
  --version X.Y.Z \
  --set adminToken="change-me"
```

Or install from a checkout of the repository (tracks `main`):

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="change-me"
```

Reference an existing Secret instead of a literal token:

```sh
helm install remotecache ./charts/remotecache \
  --set existingSecret=remotecache-admin \
  --set existingSecretKey=admin-token
```

## S3 with EKS IRSA

For S3 with EKS IRSA — no static keys, credentials resolved from the pod's IAM role:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="change-me" \
  --set storage.strategy=s3 \
  --set s3.bucket=my-cache-bucket \
  --set s3.region=us-east-1 \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/remotecache
```

Leave `s3.accessKeyId` and `s3.secretAccessKey` empty to use the ServiceAccount's IAM role; the server resolves credentials through the AWS provider chain. See [Storage strategies](/guides/storage-strategies/) for the full credential model.

## TLS

Set `tls.enabled=true` and `tls.existingSecret` to a `kubernetes.io/tls` Secret; the chart mounts it and switches the probes to HTTPS. For most deployments, terminating TLS at an ingress is simpler. See [Direct TLS](/deploy/docker/#direct-tls) for the underlying behavior.

## Rolling updates

On `SIGTERM` the server drains in-flight requests before exiting, so rolling updates do not cut off active cache reads or writes — no extra `preStop` hook is needed.

The filesystem strategy stores cache entries on a single `ReadWriteOnce` volume, so keep `replicaCount: 1` unless you switch to S3 or provide a `ReadWriteMany` volume for the cache.

## Key values

| Value                                                        | Purpose                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `replicaCount`                                               | Pod count. Keep at `1` with filesystem storage unless using S3 or an RWX cache volume. |
| `image.repository` / `image.tag`                             | Image to run; `tag` defaults to the chart `appVersion`.                                |
| `adminToken` / `existingSecret` / `existingSecretKey`        | Admin token literal, or a reference to an existing Secret.                             |
| `storage.strategy`                                           | `filesystem` (default) or `s3`.                                                        |
| `s3.*`                                                       | Bucket, region, endpoint, and optional static credentials.                             |
| `tls.*`                                                      | Direct-TLS toggle and the `kubernetes.io/tls` Secret.                                  |
| `persistence.*`                                              | PVC sizing for the token DB and cache.                                                 |
| `serviceAccount.annotations`                                 | IRSA and other cloud-identity annotations.                                             |
| `service.type` / `service.port`                              | Service exposure (`ClusterIP` by default).                                             |
| `config.bindAddress`                                         | Listen interface; `::` for IPv6 / dual-stack.                                          |
| `config.maxUploadBytes`                                      | Upload size cap.                                                                       |
| `config.verbose`                                             | Set `true` for verbose logging.                                                        |
| `resources`, `extraEnv`, `extraVolumes`, `extraVolumeMounts` | Standard overrides and escape hatches.                                                 |

See `charts/remotecache/values.yaml` for the full list and defaults.
