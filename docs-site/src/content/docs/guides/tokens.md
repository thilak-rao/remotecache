---
title: Token & admin API
description: 'Manage access to your Nx remote cache: readonly and full tokens hashed at rest, plus the admin API for creating and revoking them.'
---

The Nx remote cache controls access with three permission levels:

| Permission            | Capabilities                                   |
| --------------------- | ---------------------------------------------- |
| `readonly`            | Download cache entries (`GET /v1/cache/:hash`) |
| `full`                | Download and upload cache entries              |
| admin (`ADMIN_TOKEN`) | Manage tokens, plus everything `full` can do   |

Token values are hashed with SHA-256 before being stored. The value appears exactly once, in the response to `POST /v1/admin/tokens`. If you lose a token, it can't be recovered from the server; create a new one and delete the old one. For guidance on scoping `full` tokens to trusted contexts, see [CVE-2025-36852](/security/cve-2025-36852/).

See the [API Reference](/api/) for full request and response schemas.

## Admin endpoints

All admin endpoints require:

```
Authorization: Bearer <ADMIN_TOKEN>
```

### List tokens

```
GET /v1/admin/tokens
```

Returns `{ "tokens": [{ "id", "permission" }] }`. Token values are never included; they're stored hashed and can't be recovered.

### Create a token

```
POST /v1/admin/tokens
```

Request body:

```json
{ "id": "CI", "permission": "full" }
```

`permission` must be `"readonly"` or `"full"`. The response body has the token value. This is the only time it appears; copy it immediately.

### Delete a token

```
DELETE /v1/admin/tokens/:id
```

Pass the token's `id` (as returned by the list endpoint) in the URL path — never the token value.
Deleting by id keeps secrets out of URLs and access logs, and means a token can always be revoked
even after its value has been lost.
