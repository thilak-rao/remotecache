// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';

// https://astro.build/config
export default defineConfig({
  site: 'https://remotecache.dev',
  redirects: {
    '/guides/deployment/': '/deploy/docker/',
  },
  integrations: [
    starlight({
      title: 'remotecache',
      logo: {
        src: './src/assets/logo.png',
        alt: 'remotecache',
      },
      favicon: '/favicon.png',
      routeMiddleware: './src/route-data.ts',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/thilak-rao/remotecache',
        },
      ],
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        {
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://t.remotecache.dev/script.js',
            'data-website-id': 'd49a6f73-4e76-44f5-a0e8-7346d3251169',
          },
        },
      ],
      plugins: [
        starlightLinksValidator({
          // starlight-openapi pages are generated dynamically and don't register
          // headings with the links validator, so exclude them from validation.
          exclude: ['/api/**'],
        }),
        // Generate the API reference from the OpenAPI spec at the repo root.
        starlightOpenAPI([
          {
            base: 'api',
            schema: '../nx-cache-server.openapi.json',
            sidebar: { label: 'API Reference' },
          },
        ]),
        starlightLlmsTxt({
          projectName: 'remotecache',
          description:
            'A free, self-hosted, MIT-licensed Nx remote cache server on the Bun runtime with filesystem, S3, or GCS storage and readonly/full bearer-token auth.',
          promote: ['index*', 'getting-started/**'],
          optionalLinks: [
            {
              label: 'OpenAPI document',
              url: 'https://remotecache.dev/openapi.json',
              description:
                'Machine-readable HTTP API spec with exact endpoints, status codes, and request/response shapes',
            },
          ],
          details:
            'Every documentation page is also available as raw Markdown by appending `.md` to its URL path, for example <https://remotecache.dev/guides/configuration.md>.',
        }),
      ],
      sidebar: [
        {
          label: 'Why remotecache',
          items: [
            { label: 'Why this exists', slug: 'why' },
            { label: 'Is your Nx cache safe?', slug: 'security/cve-2025-36852' },
          ],
        },
        {
          label: 'Getting started',
          items: [{ label: 'Quickstart', slug: 'getting-started/quickstart' }],
        },
        {
          label: 'Deploy',
          items: [
            { label: 'Docker', slug: 'deploy/docker' },
            { label: 'Railway, Render, and Fly.io', slug: 'deploy/paas' },
            { label: 'Kubernetes & Helm', slug: 'deploy/kubernetes' },
            { label: 'Standalone binaries', slug: 'deploy/binaries' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Storage strategies', slug: 'guides/storage-strategies' },
            { label: 'Token & admin API', slug: 'guides/tokens' },
            { label: 'Security model', slug: 'guides/security' },
            { label: 'CI recipes', slug: 'guides/ci-recipes' },
            { label: 'Migrate from @nx/s3-cache', slug: 'guides/migrate-from-nx-s3-cache' },
          ],
        },
        {
          label: 'Compare',
          items: [{ label: 'vs Nx Cloud', slug: 'compare/nx-cloud' }],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Architecture', slug: 'contributing/architecture' },
            { label: 'Releases', slug: 'contributing/releases' },
          ],
        },
        ...openAPISidebarGroups,
      ],
    }),
  ],
});
