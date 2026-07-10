import { getCollection } from 'astro:content';
import { OGImageRoute } from 'astro-og-canvas';

const entries = await getCollection('docs');
const pages = Object.fromEntries(entries.map((entry) => [entry.id || 'index', entry.data]));

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description ?? '',
    logo: { path: './src/assets/logo.png', size: [80] },
    bgGradient: [[24, 24, 27]],
  }),
});
