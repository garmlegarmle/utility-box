import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const baseSchema = z.object({
  title: z.string(),
  description: z.string(),
  slug: z.string(),
  lang: z.enum(['en', 'ko']),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  heroImage: z.string().optional(),
  cardImage: z.string().optional(),
  pairSlug: z.string().optional()
});

const blog = defineCollection({
  loader: glob({ base: './src/content', pattern: '{en,ko}/blog/**/*.{md,mdx}' }),
  schema: baseSchema.extend({
    date: z.coerce.date()
  })
});

const pages = defineCollection({
  loader: glob({ base: './src/content', pattern: '{en,ko}/pages/**/*.{md,mdx}' }),
  schema: baseSchema.extend({
    date: z.coerce.date().optional()
  })
});

const tools = defineCollection({
  loader: glob({ base: './src/content', pattern: '{en,ko}/tools/**/*.{md,mdx}' }),
  schema: baseSchema.extend({
    date: z.coerce.date().optional()
  })
});

const games = defineCollection({
  loader: glob({ base: './src/content', pattern: '{en,ko}/games/**/*.{md,mdx}' }),
  schema: baseSchema.extend({
    date: z.coerce.date().optional()
  })
});

export const collections = {
  blog,
  pages,
  tools,
  games
};
