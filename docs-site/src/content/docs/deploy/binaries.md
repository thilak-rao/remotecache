---
title: Standalone binaries
description: Download, verify, and run the self-hosted Nx remote cache server as a standalone executable for Linux, macOS, and Windows — no Bun or container runtime required.
---

Each release attaches standalone executables to the GitHub Release for Linux, macOS (x64 and arm64), and Windows (x64), along with a `checksums.txt`. The binary bundles everything it needs, so the host does not need Bun installed.

[Docker](/deploy/docker/) is still the recommended path for production; the binaries are handy for direct host installs and quick trials.

## Download and run

Download the binary for your platform from the [Releases page](https://github.com/thilak-rao/remotecache/releases), verify it, and run it:

```sh
# verify the checksum (run from the download directory)
sha256sum -c checksums.txt --ignore-missing

# verify build provenance (optional; requires the gh CLI)
gh attestation verify remotecache-X.Y.Z-linux-x64 --repo thilak-rao/remotecache

# run
chmod +x remotecache-X.Y.Z-linux-x64
ADMIN_TOKEN="change-me" ./remotecache-X.Y.Z-linux-x64
```

The server reads the same [environment variables](/guides/configuration/) as the container; `ADMIN_TOKEN` is the only required one.
