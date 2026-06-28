---
title: Token & admin API
description: Managing access tokens and the admin API.
---

The cache has three permission levels:

| Permission            | Capabilities                                   |
| --------------------- | ---------------------------------------------- |
| `readonly`            | Download cache entries (`GET /v1/cache/:hash`) |
| `full`                | Download and upload cache entries              |
| admin (`ADMIN_TOKEN`) | Manage tokens, plus everything `full` can do   |

Token values are hashed with SHA-256 before being stored. The value appears exactly once, in the response to `POST /v1/admin/tokens`. If you lose a token, it can't be recovered from the server; create a new one and delete the old one.

See the [API Reference](/nx-cache-server-bun/api/) for full request and response schemas.

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
DELETE /v1/admin/tokens/:token
```

Pass the raw token value (not the `id`) in the URL path. The server hashes it and looks it up internally.
