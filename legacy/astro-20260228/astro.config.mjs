import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://utility-box.org',
  output: 'static',
  integrations: [mdx()]
});
