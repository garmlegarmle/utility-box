import { useRef } from 'react';
import { HoldemTournamentEmbed } from 'holdem/embed';
import type { SiteLang } from '../types';

export const TEXAS_HOLDEM_TOURNAMENT_SLUG = 'texas-holdem-tournament';

const COPY = {
  en: {
    eyebrow: 'Game / Texas Holdem',
    title: "Texas Hold'em Tournament",
    description:
      'Play a single-table tournament against local AI opponents. The embedded game runs directly in the page and keeps tournament flow, blinds, eliminations, and showdown logic in the browser.'
  },
  ko: {
    eyebrow: '게임 / 텍사스 홀덤',
    title: '텍사스 홀덤 토너먼트',
    description:
      '로컬 AI 8명을 상대로 싱글 테이블 토너먼트를 진행하는 브라우저 게임입니다. 블라인드 상승, 탈락, 쇼다운까지 페이지 안에서 바로 플레이할 수 있습니다.'
  }
} as const;

export function HoldemTournamentGameContent({ lang, embedded = false }: { lang: SiteLang; embedded?: boolean }) {
  const copy = COPY[lang];
  const seedRef = useRef(Math.floor(Date.now() % 2147483647) || 1);

  return (
    <div className={`holdem-game-shell${embedded ? ' holdem-game-shell--embedded' : ''}`}>
      {!embedded ? (
        <header className="holdem-game-head">
          <p className="holdem-game-head__eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </header>
      ) : null}

      <div className="holdem-game-stage">
        <HoldemTournamentEmbed initialSeed={seedRef.current} />
      </div>
    </div>
  );
}
