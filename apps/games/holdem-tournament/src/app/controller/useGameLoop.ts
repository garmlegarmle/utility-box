import { useEffect } from 'react';
import { useGameStore } from 'holdem/app/store/useGameStore';
import { getPlayersAbleToAct } from 'holdem/engine/core/seating';
import { ACTION_PHASES } from 'holdem/engine/stateMachine/phases';
import { selectActingSeat } from 'holdem/engine/stateMachine/selectors';
import type { GameState } from 'holdem/types/engine';

function getAdvanceDelay(game: GameState, isAiAction: boolean): number {
  if (isAiAction) {
    return Math.round(game.ui.actionSpeed * 1.18);
  }

  const allInRunout = getPlayersAbleToAct(game.seats).length < 2;

  switch (game.phase) {
    case 'deal_hole_cards':
      return 320;
    case 'deal_flop':
      return 700;
    case 'deal_turn':
    case 'deal_river':
      return allInRunout ? 1620 : 1260;
    case 'showdown':
      return 1180;
    case 'award_pots':
      return 920;
    case 'eliminate_players':
      return 820;
    default:
      return 220;
  }
}

export function useGameLoop() {
  const game = useGameStore((state) => state.game);
  const advanceOneStep = useGameStore((state) => state.advanceOneStep);
  const shouldAutoAdvance = useGameStore((state) => state.shouldAutoAdvance);

  useEffect(() => {
    if (!shouldAutoAdvance()) {
      return undefined;
    }

    const actingSeat = selectActingSeat(game);
    const isAiAction = ACTION_PHASES.includes(game.phase) && Boolean(actingSeat && !actingSeat.isHuman);
    const delay = getAdvanceDelay(game, isAiAction);
    const timer = window.setTimeout(() => {
      advanceOneStep();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [advanceOneStep, game, shouldAutoAdvance]);
}
