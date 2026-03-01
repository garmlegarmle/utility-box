import { Link } from 'react-router-dom';
import type { PostItem, SiteLang } from '../types';

interface EntryCardProps {
  post: PostItem;
  href?: string;
  lang: SiteLang;
  showDraftBadge?: boolean;
}

function rankText(post: PostItem, fallback: number): string {
  if (post.card.rank) return post.card.rank;
  if (post.card.rankNumber) return `#${post.card.rankNumber}`;
  return `#${fallback}`;
}

export function EntryCard({ post, href, lang, showDraftBadge = false }: EntryCardProps) {
  const targetHref = href || `/${lang}/${post.section}/${post.slug}/`;
  const cardTitle = post.card.title || post.title;
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const titleClass = cardTitle.length >= 18 ? 'entry-card__title entry-card__title--compact' : 'entry-card__title';
  const rank = rankText(post, 1);
  const rankDigits = rank.replace(/\D/g, '').length;
  const rankClass = rankDigits >= 3 || rank.length >= 4 ? 'entry-card__rank entry-card__rank--compact' : 'entry-card__rank';
  const image = post.card.imageUrl || post.cover?.url || '';

  return (
    <article className="entry-card">
      <Link className="entry-card__link" to={targetHref}>
        <div className="entry-card__media">
          {image ? (
            <img className="entry-card__image" src={image} alt={cardTitle} loading="lazy" decoding="async" />
          ) : (
            <div className="entry-card__placeholder">이미지 혹은 숫자</div>
          )}
        </div>
        <div className="entry-card__info">
          <p className="entry-card__meta">
            <span>{post.card.category || post.section}</span>
            <span className="entry-card__meta-right">
              {showDraftBadge && post.status === 'draft' ? (
                <span className="entry-card__draft">draft</span>
              ) : null}
              <span>{post.card.tag || tags[0] || 'Tag'}</span>
            </span>
          </p>
          <p className="entry-card__title-row">
            <span className={titleClass}>{cardTitle}</span>
            <span className={rankClass}>{rank}</span>
          </p>
        </div>
      </Link>
    </article>
  );
}
