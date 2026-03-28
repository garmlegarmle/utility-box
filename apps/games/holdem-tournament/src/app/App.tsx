import { useEffect, useRef } from 'react';
import { useGameLoop } from 'holdem/app/controller/useGameLoop';
import { useGameStore } from 'holdem/app/store/useGameStore';
import { TableScreen } from 'holdem/components/table/TableScreen';
import type { TournamentCompletionReason } from 'holdem/types/engine';
import styles from 'holdem/app/App.module.css';

export type HoldemAppLayoutMode = 'fullscreen' | 'embedded';

export interface TournamentCompletePayload {
  reason: TournamentCompletionReason;
  winnerId: string | null;
  winnerName: string | null;
  playerWon: boolean;
  finalPlace: number;
  handNumber: number;
  level: number;
}

export interface HoldemTournamentAppProps {
  layoutMode?: HoldemAppLayoutMode;
  className?: string;
  initialSeed?: number;
  lang?: 'en' | 'ko';
  playerName?: string;
  skipNamePrompt?: boolean;
  onPlayerNameChange?: (value: string) => void;
  onTournamentStart?: (playerName: string) => void;
  onTournamentComplete?: (payload: TournamentCompletePayload) => void;
}

export default function App({
  layoutMode = 'fullscreen',
  className,
  initialSeed,
  lang = 'ko',
  playerName = '',
  skipNamePrompt = false,
  onPlayerNameChange,
  onTournamentStart,
  onTournamentComplete,
}: HoldemTournamentAppProps) {
  const initialize = useGameStore((state) => state.initialize);
  const game = useGameStore((state) => state.game);
  const completionKeyRef = useRef<string | null>(null);
  useGameLoop();

  useEffect(() => {
    initialize(initialSeed, undefined, lang);
  }, [initialize, initialSeed, lang]);

  useEffect(() => {
    completionKeyRef.current = null;
  }, [game.ui.lastSeed]);

  useEffect(() => {
    if (game.phase !== 'tournament_complete' || !game.tournamentCompletionReason || !onTournamentComplete) {
      return;
    }

    const winner = game.seats.find((seat) => seat.playerId === game.tournamentWinnerId);
    const key = [
      game.ui.lastSeed,
      game.tournamentCompletionReason,
      game.hand.handNumber,
      game.tournamentWinnerId ?? 'none',
    ].join(':');

    if (completionKeyRef.current === key) {
      return;
    }

    completionKeyRef.current = key;
    const humanSeat = game.seats.find((seat) => seat.isHuman);

    onTournamentComplete({
      reason: game.tournamentCompletionReason,
      winnerId: game.tournamentWinnerId,
      winnerName: winner?.name ?? null,
      playerWon: Boolean(winner?.isHuman),
      finalPlace: winner?.isHuman ? 1 : Math.max(1, Number(humanSeat?.eliminationOrder || game.seats.length)),
      handNumber: game.hand.handNumber,
      level: game.currentLevel.level,
    });
  }, [game, onTournamentComplete]);

  return (
    <div
      className={[
        'holdem-app-theme',
        styles.shell,
        layoutMode === 'embedded' ? styles.embedded : styles.fullscreen,
        className ?? '',
      ].join(' ')}
    >
      <TableScreen
        layoutMode={layoutMode}
        lang={lang}
        playerName={playerName}
        skipNamePrompt={skipNamePrompt}
        onPlayerNameChange={onPlayerNameChange}
        onTournamentStart={onTournamentStart}
      />
    </div>
  );
}
