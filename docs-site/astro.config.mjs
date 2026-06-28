// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import starlightLinksValidator from 'starlight-links-validator';

// https://astro.build/config
export default defineConfig({
  site: 'https://thilak-rao.github.io',
  base: '/nx-cache-server-bun',
  integrations: [
    starlight({
      title: 'nx-cache-server-bun',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/thilak-rao/nx-cache-server-bun',
        },
      ],
      plugins: [
        starlightLinksValidator({
          // starlight-openapi pages are generated dynamically and don't register
          // headings with the links validator, so exclude them from validation.
          exclude: ['/nx-cache-server-bun/api/**'],
        }),
        // Generate the API reference from the OpenAPI spec at the repo root.
        starlightOpenAPI([
          {
            base: 'api',
            schema: '../nx-cache-server.openapi.json',
            sidebar: { label: 'API Reference' },
          },
        ]),
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [{ label: 'Quickstart', slug: 'getting-started/quickstart' }],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Storage strategies', slug: 'guides/storage-strategies' },
            { label: 'Token & admin API', slug: 'guides/tokens' },
            { label: 'Security model', slug: 'guides/security' },
            { label: 'Deployment', slug: 'guides/deployment' },
          ],
        },
        {
          label: 'Contributing',
          items: [{ label: 'Architecture', slug: 'contributing/architecture' }],
        },
        ...openAPISidebarGroups,
      ],
    }),
  ],
});
