# auth.md for remotecache

remotecache uses operator-provisioned bearer tokens. It does not support OAuth/OIDC discovery, dynamic client registration, or automated agent registration today.

## Cache access

Nx cache clients call remotecache with an `Authorization: Bearer TOKEN_VALUE` header. Operators create cache tokens through the admin API or another trusted provisioning process.

Cache tokens have one permission:

- `readonly`: download cache artifacts only.
- `full`: download and upload cache artifacts.

Use `readonly` tokens for untrusted CI, including pull request builds from forks. Use `full` tokens only in trusted build contexts that are allowed to write to the cache.

## Admin access

Token administration uses the `ADMIN_TOKEN` configured on the server. The admin API can create, list, and delete cache tokens. Do not expose `ADMIN_TOKEN` to agents, browser clients, or untrusted CI.

## Discovery

The API reference is at https://remotecache.dev/api/
The OpenAPI document is at https://remotecache.dev/openapi.json
