/* eslint-disable no-console -- build/CLI script: stdout progress is intentional */

const here = (path) => new URL(path, import.meta.url);
const root = (path) => here(`../../${path}`);
const docs = (path) => here(`../${path}`);

const openApiSource = root('nx-cache-server.openapi.json');
const openApiTarget = docs('public/openapi.json');
const skillSource = docs('public/.well-known/agent-skills/remotecache/SKILL.md');
const skillIndexTarget = docs('public/.well-known/agent-skills/index.json');

const openApi = await Bun.file(openApiSource).text();
JSON.parse(openApi);
await Bun.write(openApiTarget, openApi);
console.log('wrote public/openapi.json');

const skillBytes = new Uint8Array(await Bun.file(skillSource).arrayBuffer());
const digestBuffer = await crypto.subtle.digest('SHA-256', skillBytes);
const digest = [...new Uint8Array(digestBuffer)]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const index = {
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [
    {
      name: 'remotecache',
      type: 'skill-md',
      description:
        'Use remotecache, a self-hosted Nx remote cache server with filesystem or S3 storage and bearer-token auth.',
      url: 'https://remotecache.dev/.well-known/agent-skills/remotecache/SKILL.md',
      digest: `sha256:${digest}`,
    },
  ],
};

await Bun.write(skillIndexTarget, `${JSON.stringify(index, null, 2)}\n`);
console.log('wrote public/.well-known/agent-skills/index.json');
