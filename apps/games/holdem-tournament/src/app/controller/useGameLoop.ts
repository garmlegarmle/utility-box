import { useEffect } from 'react';
import { useGameStore } from 'holdem/app/store/useGameStore';
import { ACTION_PHASES } from 'holdem/engine/stateMachine/phases';
import { selectActingSeat } from 'holdem/engine/stateMachine/selectors';

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
    const delay = isAiAction ? game.ui.actionSpeed : 90;
    const timer = window.setTimeout(() => {
      advanceOneStep();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [advanceOneStep, game, shouldAutoAdvance]);
}
