import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pathId = ({ entry }: { entry: string }) => entry.replace(/\.[^.]+$/u, '');

const backgroundSchema = z.object({
  type: z.enum(['none', 'solid', 'image']).default('none'),
  color: z.string().optional(),
  imageSrc: z.string().optional()
});

const sectionSettingsSchema = z.object({
  width: z.enum(['container', 'full']).default('container'),
  align: z.enum(['left', 'center']).default('left'),
  spacing: z.enum(['compact', 'normal', 'loose']).default('normal'),
  bg: backgroundSchema.default({ type: 'none' })
});

const isExternalUrl = (value: string): boolean => /^(https?:)?\/\//i.test(value) || value.startsWith('mailto:');

const validateLinkTarget = (
  value: { kind?: 'internal' | 'external'; internalRoute?: string; externalUrl?: string; href?: string },
  ctx: z.RefinementCtx
) => {
  const kind = value.kind ?? 'internal';
  const internal = value.internalRoute ?? value.href ?? '';
  const external = value.externalUrl ?? value.href ?? '';

  if (kind === 'internal' && !internal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Internal links require internalRoute (or href).'
    });
  }

  if (kind === 'external') {
    if (!external) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'External links require externalUrl (or href).'
      });
      return;
    }

    if (!isExternalUrl(external)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'External links must use absolute URL or mailto.'
      });
    }
  }
};

const linkCoreSchema = z.object({
  kind: z.enum(['internal', 'external']).default('internal'),
  internalRoute: z.string().optional(),
  externalUrl: z.string().optional(),
  href: z.string().optional(),
  openInNewTab: z.boolean().optional()
});

const sectionLinkSchema = linkCoreSchema
  .extend({
    label: z.string()
  })
  .superRefine(validateLinkTarget);

const cardGridItemSchema = linkCoreSchema
  .extend({
    title: z.string(),
    description: z.string(),
    imageSrc: z.string().optional(),
    meta: z.string().optional()
  })
  .superRefine(validateLinkTarget);

const sectionBaseSchema = z.object({
  id: z.string(),
  settings: sectionSettingsSchema.default({
    width: 'container',
    align: 'left',
    spacing: 'normal',
    bg: { type: 'none' }
  })
});

const sectionSchema = z.discriminatedUnion('type', [
  sectionBaseSchema.extend({
    type: z.literal('Hero'),
    heading: z.string().optional(),
    subheading: z.string().optional(),
    mediaEnabled: z.boolean().optional(),
    mediaSrc: z.string().optional(),
    mediaAlt: z.string().optional(),
    links: z.array(sectionLinkSchema).optional()
  }),
  sectionBaseSchema.extend({
    type: z.literal('RichText'),
    body: z.string()
  }),
  sectionBaseSchema.extend({
    type: z.literal('Media'),
    src: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
    ratio: z.enum(['1:1', '4:3', '16:9']).default('4:3')
  }),
  sectionBaseSchema.extend({
    type: z.literal('MediaText'),
    mediaEnabled: z.boolean().optional(),
    src: z.string().optional(),
    alt: z.string().optional(),
    body: z.string(),
    mediaPosition: z.enum(['top', 'left', 'right']).default('top')
  }),
  sectionBaseSchema.extend({
    type: z.literal('ToolEmbed'),
    route: z.string(),
    title: z.string().optional(),
    description: z.string().optional()
  }),
  sectionBaseSchema.extend({
    type: z.literal('GameEmbed'),
    route: z.string(),
    title: z.string().optional(),
    description: z.string().optional()
  }),
  sectionBaseSchema.extend({
    type: z.literal('LinkList'),
    title: z.string().optional(),
    items: z.array(sectionLinkSchema)
  }),
  sectionBaseSchema.extend({
    type: z.literal('CardGrid'),
    title: z.string().optional(),
    items: z.array(cardGridItemSchema),
    columns: z
      .union([z.literal(2), z.literal(3), z.literal('2'), z.literal('3')])
      .optional()
      .transform((value) => (value ? Number(value) : undefined))
  }),
  sectionBaseSchema.extend({
    type: z.literal('Callout'),
    title: z.string().optional(),
    body: z.string(),
    tone: z.enum(['neutral', 'info']).default('neutral')
  }),
  sectionBaseSchema.extend({
    type: z.literal('Divider'),
    variant: z.enum(['line', 'space']).default('line')
  })
]);

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
  loader: glob({ base: './src/content', pattern: '{en,ko}/blog/**/*.{md,mdx}', generateId: pathId }),
  schema: baseSchema.extend({
    date: z.coerce.date()
  })
});

const pages = defineCollection({
  loader: glob({ base: './src/content', pattern: 'pages/{en,ko}/**/*.{md,mdx}', generateId: pathId }),
  schema: baseSchema.extend({
    date: z.coerce.date().optional(),
    pageBg: backgroundSchema.default({ type: 'none' }),
    sections: z.array(sectionSchema).default([])
  })
});

const tools = defineCollection({
  loader: glob({ base: './src/content', pattern: '{en,ko}/tools/**/*.{md,mdx}', generateId: pathId }),
  schema: baseSchema.extend({
    date: z.coerce.date().optional()
  })
});

const games = defineCollection({
  loader: glob({ base: './src/content', pattern: '{en,ko}/games/**/*.{md,mdx}', generateId: pathId }),
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
