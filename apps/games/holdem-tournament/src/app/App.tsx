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
  handNumber: number;
  level: number;
}

export interface HoldemTournamentAppProps {
  layoutMode?: HoldemAppLayoutMode;
  className?: string;
  initialSeed?: number;
  onTournamentComplete?: (payload: TournamentCompletePayload) => void;
}

export default function App({
  layoutMode = 'fullscreen',
  className,
  initialSeed,
  onTournamentComplete,
}: HoldemTournamentAppProps) {
  const initialize = useGameStore((state) => state.initialize);
  const game = useGameStore((state) => state.game);
  const completionKeyRef = useRef<string | null>(null);
  useGameLoop();

  useEffect(() => {
    initialize(initialSeed);
  }, [initialize, initialSeed]);

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

    onTournamentComplete({
      reason: game.tournamentCompletionReason,
      winnerId: game.tournamentWinnerId,
      winnerName: winner?.name ?? null,
      playerWon: Boolean(winner?.isHuman),
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
      <TableScreen layoutMode={layoutMode} />
    </div>
  );
}
