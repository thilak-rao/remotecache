# Umami Tracking and Agent Readiness - Design

> Approved 2026-07-07. Scope is Approach 2 from brainstorming: repo-owned
> docs-site changes plus direct Cloudflare/DNS configuration for
> `remotecache.dev`. The discovery surface must stay accurate to what
> remotecache actually provides.

**Goal:** Add Umami analytics to the docs site and make the site easier for
agents to discover and consume, without claiming unsupported OAuth, MCP,
WebMCP, or hosted-cache capabilities.

**Non-goals:** Do not build an OAuth/OIDC authorization server, MCP server,
WebMCP browser tools, A2A endpoint, or hosted remotecache API instance. Do not
add Terraform, Wrangler, or other infrastructure-as-code just to manage the
small Cloudflare changes in this pass.

## Decisions made during brainstorming

1. **Analytics:** add the provided Umami script globally through Starlight's
   `head` config so every docs page is tracked.
2. **API catalog semantics:** advertise the documented self-hosted
   remotecache API contract from `remotecache.dev`, while avoiding any claim
   that `remotecache.dev` itself is a live cache API endpoint.
3. **Strict accuracy:** publish only discovery documents for real resources.
   OAuth/OIDC, OAuth Protected Resource Metadata, MCP Server Card, and WebMCP
   stay absent until the product supports those capabilities.
4. **Cloudflare changes:** apply headers, Markdown negotiation, DNS-AID, and
   DNSSEC directly through Cloudflare. The repo will document the intended
   configuration, but this change will not introduce zone-management IaC.

## Docs-site changes

The docs site is an Astro/Starlight static site under `docs-site/`, deployed
through GitHub Pages and fronted by Cloudflare.

### Umami tracking

Add this script to the global Starlight `head` config in
`docs-site/astro.config.mjs`:

```html
<script
  defer
  src="https://t.numen.ie/script.js"
  data-website-id="d49a6f73-4e76-44f5-a0e8-7346d3251169"
></script>
```

### Public OpenAPI description

Publish the raw OpenAPI document at:

```text
https://remotecache.dev/openapi.json
```

The source of truth remains the repo-root `nx-cache-server.openapi.json`.
Because Astro only ships files from `docs-site/public/`, add a small build
step or script that copies the root spec into the docs public directory before
`astro build`. The copied file is a deployment artifact input, not a new API
source of truth.

### API catalog

Serve `/.well-known/api-catalog` as Linkset JSON:

```text
Content-Type: application/linkset+json
```

The catalog should include one entry for the self-hosted remotecache API
contract:

- `anchor`: `https://remotecache.dev/api/`
- `service-desc`: `https://remotecache.dev/openapi.json`
- `service-doc`: `https://remotecache.dev/api/`
- `status`: `https://remotecache.dev/api/operations/gethealth/`

The `status` link points to the health-check documentation, not
`https://remotecache.dev/health`, because the docs host is not a running cache
server. If GitHub Pages does not serve the extensionless well-known file with
`application/linkset+json`, set that response header at Cloudflare for this
path.

### Agent skills index

Publish a real Agent Skills index at:

```text
https://remotecache.dev/.well-known/agent-skills/index.json
```

The index should contain one `skill-md` entry for a short skill document that
teaches agents how to understand and configure remotecache. The skill can link
to the quickstart, API docs, OpenAPI description, token guide, and security
guide. Generate or verify the `sha256:{hex}` digest from the checked-in
`SKILL.md` artifact during implementation so the index cannot drift silently.

### Auth guidance

Publish `/auth.md` with a short, self-contained explanation:

- remotecache uses bearer tokens for cache access.
- operators provision tokens through the admin API or out-of-band process.
- the server does not support OAuth/OIDC discovery or dynamic agent
  registration today.
- admin access uses `ADMIN_TOKEN`; cache tokens are hashed at rest and have
  `readonly` or `full` permission.

This file exists to help agents understand the real auth model. It must not
pretend that OAuth registration exists.

## Cloudflare and DNS changes

GitHub Pages cannot set arbitrary response headers or negotiate Markdown based
on the `Accept` header. Those pieces belong at the Cloudflare edge.

### Homepage Link headers

Add `Link` response headers on `https://remotecache.dev/`:

```http
Link: </.well-known/api-catalog>; rel="api-catalog"
Link: </openapi.json>; rel="service-desc"; type="application/json"
Link: </api/>; rel="service-doc"
Link: </auth.md>; rel="describedby"
Link: </.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"
```

Multiple `Link` headers or one comma-separated header are both valid under
RFC 8288. Use the Cloudflare mechanism with the smallest blast radius: a
Response Header Transform Rule if it can target the homepage cleanly, otherwise
a Worker route for the homepage.

### Markdown for Agents

Enable Cloudflare Markdown for Agents for `remotecache.dev`, or at minimum for
the docs hostname/path. Requests with:

```http
Accept: text/markdown
```

should return:

```http
Content-Type: text/markdown
```

The Cloudflare response may also include `x-markdown-tokens` and
`x-original-tokens`; those are edge-generated and do not need Astro changes.

### DNS-AID

Publish a truthful DNS-AID discovery record under `_agents.remotecache.dev`.
The first record should point agents back to the HTTPS discovery surface, not
to an A2A or MCP endpoint that does not exist.

Before applying records, inspect current Cloudflare DNS support for SVCB/HTTPS
records and the DNS-AID draft's current syntax. Use experimental numeric
`keyNNNNN` parameters only if needed. Enable DNSSEC for the zone if it is not
already signed.

## Unsupported scanner checks

Leave these absent in this pass:

- `/.well-known/openid-configuration`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`
- `/.well-known/mcp/server-card.json`
- WebMCP browser tool registration

Those endpoints imply capabilities remotecache does not currently have.
Failing those scanner checks is preferable to inaccurate metadata.

## Verification

Repo checks:

```sh
cd docs-site
bun run build
```

Then verify the generated files:

- `dist/index.html` contains the Umami script.
- `dist/openapi.json` exists and matches the root OpenAPI source.
- `dist/.well-known/api-catalog` exists and contains valid Linkset JSON.
- `dist/.well-known/agent-skills/index.json` exists and its digest matches the
  published skill artifact.
- `dist/auth.md` exists and describes the token-based auth model accurately.

Live checks after deployment and Cloudflare changes:

```sh
curl -I https://remotecache.dev/
curl -H 'Accept: text/markdown' -I https://remotecache.dev/
dig HTTPS _index._agents.remotecache.dev
```

Then rerun the `isitagentready.com` scan. Expected improvements:

- Link headers: pass
- Markdown negotiation: pass
- API catalog: pass
- Agent skills index: pass
- DNS-AID: pass if the final record shape is accepted by the scanner

Expected remaining failures unless the product later adds real support:

- OAuth/OIDC discovery
- OAuth Protected Resource Metadata
- Auth.md agent registration beyond static token guidance, if the scanner
  requires dynamic registration
- MCP Server Card
- WebMCP
