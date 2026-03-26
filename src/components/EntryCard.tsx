import { Link } from 'react-router-dom';
import { sectionLabel, t } from '../lib/site';
import type { CardTitleSize, PostItem, SiteLang } from '../types';

interface EntryCardProps {
  post: PostItem;
  href?: string;
  lang: SiteLang;
  showDraftBadge?: boolean;
}

const DEFAULT_CARD_IMAGE_URL = '/card-1.png';

function rankText(post: PostItem, fallback: number): string {
  if (post.card.rank) return post.card.rank;
  if (post.card.rankNumber) return `#${post.card.rankNumber}`;
  return `#${fallback}`;
}

function displayCategory(rawCategory: string | null | undefined, post: PostItem, lang: SiteLang): string {
  const raw = String(rawCategory || '').trim();
  const normalized = raw.toLowerCase();
  if (!raw) return sectionLabel(post.section, lang);

  if (normalized === 'blog') return sectionLabel('blog', lang);
  if (normalized === 'tool' || normalized === 'tools') return sectionLabel('tools', lang);
  if (normalized === 'game' || normalized === 'games') return sectionLabel('games', lang);
  if (normalized === 'page' || normalized === 'pages') return sectionLabel('pages', lang);
  return raw;
}

function displayTag(rawTag: string | null | undefined, tags: string[], lang: SiteLang): string {
  const raw = String(rawTag || '').trim();
  if (!raw) return tags[0] || t(lang, 'card.tagFallback');
  if (raw.toLowerCase() === 'tag') return t(lang, 'card.tagFallback');
  return raw;
}

function weightedTitleLength(title: string): number {
  let total = 0;
  for (const char of [...String(title || '')]) {
    if (/\s/.test(char)) {
      total += 0.4;
      continue;
    }
    if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u2e80-\u9fff\uff01-\uff60\uffa0-\uffef]/.test(char)) {
      total += 2;
      continue;
    }
    total += 1;
  }
  return total;
}

function titleClassName(title: string, titleSize: CardTitleSize = 'auto'): string {
  if (titleSize === 'default') return 'entry-card__title';
  if (titleSize === 'compact' || titleSize === 'auto') return 'entry-card__title entry-card__title--compact';
  if (titleSize === 'tight') return 'entry-card__title entry-card__title--tight';
  if (titleSize === 'ultra-tight') return 'entry-card__title entry-card__title--ultra-tight';

  const length = weightedTitleLength(title);
  if (length >= 36) return 'entry-card__title entry-card__title--ultra-tight';
  if (length >= 28) return 'entry-card__title entry-card__title--tight';
  if (length >= 18) return 'entry-card__title entry-card__title--compact';
  return 'entry-card__title';
}

export function EntryCard({ post, href, lang, showDraftBadge = false }: EntryCardProps) {
  const targetHref = href || `/${lang}/${post.section}/${post.slug}/`;
  const cardTitle = post.card.title || post.title;
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const titleClass = titleClassName(cardTitle, post.card.titleSize || 'auto');
  const rank = rankText(post, 1);
  const image = post.card.imageUrl || DEFAULT_CARD_IMAGE_URL;
  const categoryText = displayCategory(post.card.category, post, lang);
  const tagText = displayTag(post.card.tag, tags, lang);

  return (
    <article className="entry-card">
      <Link className="entry-card__link" to={targetHref}>
        <div className="entry-card__media">
          <img className="entry-card__image" src={image} alt={cardTitle} loading="lazy" decoding="async" />
        </div>
        <div className="entry-card__info">
          <p className="entry-card__meta">
            <span className="entry-card__meta-side entry-card__meta-side--start">{categoryText}</span>
            <span className="entry-card__meta-center">
              <span className="entry-card__rank">{rank}</span>
            </span>
            <span className="entry-card__meta-side entry-card__meta-side--end">
              {showDraftBadge && post.status === 'draft' ? (
                <span className="entry-card__draft">{t(lang, 'card.draft')}</span>
              ) : null}
              <span>{tagText}</span>
            </span>
          </p>
          <p className={titleClass}>{cardTitle}</p>
        </div>
      </Link>
    </article>
  );
}
