# Changelog

## [3.0.0](https://github.com/thilak-rao/remotecache/compare/v2.1.0...v3.0.0) (2026-07-06)


### ⚠ BREAKING CHANGES

* the Helm chart rejects replicaCount > 1 because the token database and data/cache volumes are single-writer.

### Features

* harden remote cache operations ([6303566](https://github.com/thilak-rao/remotecache/commit/6303566335c6575077230115217ae49bc76a7683))
* **health:** add health response helper ([99fb78e](https://github.com/thilak-rao/remotecache/commit/99fb78ef6e7079da3036029427495dc581c4a820))
* **health:** add unauthenticated health endpoint ([87125c5](https://github.com/thilak-rao/remotecache/commit/87125c5c862ad6b75511d8f6af824f8f88087865))
* **helm:** add core templates for deployment, service, secret, pvc, sa ([46df999](https://github.com/thilak-rao/remotecache/commit/46df9995aea4d2577d9b4b47fcaa0aee5cb64622))
* **helm:** scaffold chart with values and helpers ([bbbf8a3](https://github.com/thilak-rao/remotecache/commit/bbbf8a3c33476fa9a9e2aa7bcadac2b221f49d2e))
* **s3:** resolve credentials via AWS provider chain for IRSA support ([0b869b2](https://github.com/thilak-rao/remotecache/commit/0b869b2f3dd0a6ec939074adcf1814e9b56bb691))
* **server:** add BIND_ADDRESS listen option with IPv6 support ([4a54be5](https://github.com/thilak-rao/remotecache/commit/4a54be5fd816ec0ca6158fcaa758467711077c57))
* **server:** add direct TLS via TLS_CERT_PATH and TLS_KEY_PATH ([d8a72fb](https://github.com/thilak-rao/remotecache/commit/d8a72fb00ba6ead0bd286bfc55230a3324f92443))
* **server:** drain in-flight requests on SIGTERM and SIGINT ([23797cd](https://github.com/thilak-rao/remotecache/commit/23797cdd23b8d870bb84182435c4437c52b9135b))


### Bug Fixes

* **cache:** reject dots and cap hash length at 128 ([9764d3f](https://github.com/thilak-rao/remotecache/commit/9764d3fdbb977b4e0c0bf5e80e4b5c61659c3c97))
* **chart:** drop hook-succeeded so helm test --logs can read the pod ([8f3299c](https://github.com/thilak-rao/remotecache/commit/8f3299cbe64e373b12741b2fd0033bf8a32ee98c))
* **chart:** require ingress hosts, default pathType, guard sweepIntervalMs under s3 ([e2907da](https://github.com/thilak-rao/remotecache/commit/e2907da8dbbf6fba46763dc8792268ec0f761465))
* **ci:** set GH_REPO so the checkout-less binary publish job can resolve the repo ([e28d14e](https://github.com/thilak-rao/remotecache/commit/e28d14ef0cad14da65076220d0f18f573da4eb24))
* **deps:** override vulnerable docs form-data ([2646865](https://github.com/thilak-rao/remotecache/commit/264686574da21996dbe88b4a93362cd2b5b73993))
* **docker:** upgrade openssl to clear CVE-2026-45447 ([3e65500](https://github.com/thilak-rao/remotecache/commit/3e65500e252b0069abf08d1351ac9daaacd0f600))
* drain uploads on shutdown and harden S3 and chart config ([821c113](https://github.com/thilak-rao/remotecache/commit/821c1138de6d615916fce569fcfe59ece8d0e98a))
* **helm:** render MAX_UPLOAD_BYTES as an integer, not scientific notation ([5136f13](https://github.com/thilak-rao/remotecache/commit/5136f13f5e6c7dc1e6b79079ba10f5fb440af331))
* **s3:** abort multipart upload on write error ([621c0c0](https://github.com/thilak-rao/remotecache/commit/621c0c0ac971a8caf89b04f29a89f241501112c5))
* **s3:** coalesce concurrent credential refreshes into one provider call ([a74e202](https://github.com/thilak-rao/remotecache/commit/a74e202839a7d0b946cb706bd92a2dbae841b117))
* **s3:** surface backend error bodies and explain missing conditional-write support ([9a31f6d](https://github.com/thilak-rao/remotecache/commit/9a31f6d569d00d7a4d6f2b341ad5864fdcc08b81))
* **server:** log and exit non-zero if graceful shutdown fails ([a924250](https://github.com/thilak-rao/remotecache/commit/a9242509cca1fe1fa75e157de830b0e809e048a6))

## 2.0.0

- Baseline version for automated releases. Earlier release history predates Release Please.
