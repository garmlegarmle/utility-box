import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pathId = ({ entry }: { entry: string }) => entry.replace(/\.[^.]+$/u, '');

const sharedSchema = z.object({
  title: z.string(),
  description: z.string(),
  slug: z.string(),
  lang: z.enum(['en', 'ko']),
  image: z.string().optional(),
  heroImage: z.string().optional(),
  cardImage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  pairSlug: z.string().optional()
});

const blog = defineCollection({
  loader: glob({
    base: './src/content',
    pattern: 'blog/{en,ko}/**/*.{md,mdx}',
    generateId: pathId
  }),
  schema: sharedSchema.extend({
    date: z.coerce.date()
  })
});

const tools = defineCollection({
  loader: glob({
    base: './src/content',
    pattern: 'tools/{en,ko}/**/*.{md,mdx}',
    generateId: pathId
  }),
  schema: sharedSchema.extend({
    date: z.coerce.date().optional()
  })
});

const games = defineCollection({
  loader: glob({
    base: './src/content',
    pattern: 'games/{en,ko}/**/*.{md,mdx}',
    generateId: pathId
  }),
  schema: sharedSchema.extend({
    date: z.coerce.date().optional()
  })
});

const pages = defineCollection({
  loader: glob({
    base: './src/content',
    pattern: 'pages/{en,ko}/**/*.{md,mdx}',
    generateId: pathId
  }),
  schema: sharedSchema.extend({
    date: z.coerce.date().optional()
  })
});

export const collections = {
  blog,
  tools,
  games,
  pages
};
