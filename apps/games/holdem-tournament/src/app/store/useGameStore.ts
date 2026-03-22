import { create } from 'zustand';
import { DEFAULT_TOURNAMENT_CONFIG } from 'holdem/config/gameSettings';
import { ACTION_PHASES, AUTO_ADVANCE_PHASES } from 'holdem/engine/stateMachine/phases';
import {
  advanceState,
  applyPlayerAction,
  createInitialGameState,
  getLegalActions,
} from 'holdem/engine/stateMachine/reducer';
import { selectActingSeat, selectHumanSeat } from 'holdem/engine/stateMachine/selectors';
import type { LegalAction } from 'holdem/types/engine';
import type { ToastMessage } from 'holdem/types/ui';

function createSeed(): number {
  return Date.now() >>> 0;
}

function enqueueToast(game: ReturnType<typeof createInitialGameState>, kind: ToastMessage['kind'], text: string): void {
  game.ui.toastQueue = game.ui.toastQueue.filter((toast) => !(toast.kind === kind && toast.text === text));
  game.ui.toastQueue.push({
    id: `${Date.now()}-${Math.random()}`,
    kind,
    text,
  });
  game.ui.toastQueue = game.ui.toastQueue.slice(-4);
}

function enhanceTransition(previous: ReturnType<typeof createInitialGameState>, next: ReturnType<typeof createInitialGameState>) {
  if (next.levelIndex > previous.levelIndex) {
    enqueueToast(
      next,
      'info',
      `레벨 ${next.currentLevel.level} 시작: ${next.currentLevel.smallBlind}/${next.currentLevel.bigBlind}`,
    );
  }

  const newEliminations = next.log.filter(
    (entry) => entry.type === 'eliminated' && !previous.log.some((previousEntry) => previousEntry.id === entry.id),
  );

  newEliminations.forEach((entry) => enqueueToast(next, 'warning', entry.text));

  if (next.hand.winnerMessage && next.hand.winnerMessage !== previous.hand.winnerMessage) {
    enqueueToast(next, 'success', next.hand.winnerMessage);
  }

  if (next.phase === 'tournament_complete' && next.tournamentWinnerId && next.tournamentWinnerId !== previous.tournamentWinnerId) {
    const winner = next.seats.find((seat) => seat.playerId === next.tournamentWinnerId);
    enqueueToast(next, 'success', `${winner?.name ?? '우승자'} 우승`);
  }
}

function clampRaiseInput(game: ReturnType<typeof createInitialGameState>, nextValue: number): number {
  const humanSeat = selectHumanSeat(game);

  if (!humanSeat) {
    return nextValue;
  }

  const raiseAction = getLegalActions(game, humanSeat.playerId).find(
    (action): action is Extract<LegalAction, { min: number; max: number }> => 'min' in action,
  );

  if (!raiseAction) {
    return nextValue;
  }

  return Math.max(raiseAction.min, Math.min(raiseAction.max, Math.round(nextValue)));
}

type GameStore = {
  game: ReturnType<typeof createInitialGameState>;
  initialize: (seed?: number) => void;
  startTournament: () => void;
  restart: (seed?: number) => void;
  advanceOneStep: () => void;
  performHumanAction: (type: LegalAction['type'], amount?: number) => void;
  setRaiseInput: (amount: number) => void;
  setActionSpeed: (amount: number) => void;
  toggleAutoProgress: () => void;
  openOverlayPanel: (panel: 'settings' | 'history') => void;
  closeOverlayPanel: () => void;
  dismissToast: (id: string) => void;
  shouldAutoAdvance: () => boolean;
};

export const useGameStore = create<GameStore>((set, get) => ({
  game: createInitialGameState(DEFAULT_TOURNAMENT_CONFIG, createSeed()),
  initialize: (seed) =>
    set(() => ({
      game: createInitialGameState(DEFAULT_TOURNAMENT_CONFIG, seed ?? createSeed()),
    })),
  startTournament: () =>
    set((store) => ({
      game: {
        ...store.game,
        ui: {
          ...store.game.ui,
          started: true,
        },
      },
    })),
  restart: (seed) =>
    set(() => ({
      game: createInitialGameState(DEFAULT_TOURNAMENT_CONFIG, seed ?? createSeed()),
    })),
  advanceOneStep: () =>
    set((store) => {
      const next = advanceState(store.game);
      enhanceTransition(store.game, next);
      return { game: next };
    }),
  performHumanAction: (type, amount) =>
    set((store) => {
      const humanSeat = selectHumanSeat(store.game);

      if (!humanSeat) {
        return store;
      }

      const next = applyPlayerAction(store.game, {
        playerId: humanSeat.playerId,
        type,
        amount,
      });
      enhanceTransition(store.game, next);
      return { game: next };
    }),
  setRaiseInput: (amount) =>
    set((store) => ({
      game: {
        ...store.game,
        ui: {
          ...store.game.ui,
          raiseInput: clampRaiseInput(store.game, amount),
        },
      },
    })),
  setActionSpeed: (amount) =>
    set((store) => ({
      game: {
        ...store.game,
        ui: {
          ...store.game.ui,
          actionSpeed: Math.max(150, Math.min(2000, Math.round(amount))),
        },
      },
    })),
  toggleAutoProgress: () =>
    set((store) => ({
      game: {
        ...store.game,
        ui: {
          ...store.game.ui,
          autoProgress: !store.game.ui.autoProgress,
        },
      },
    })),
  openOverlayPanel: (panel) =>
    set((store) => ({
      game: {
        ...store.game,
        ui: {
          ...store.game.ui,
          overlayPanel: panel,
        },
      },
    })),
  closeOverlayPanel: () =>
    set((store) => ({
      game: {
        ...store.game,
        ui: {
          ...store.game.ui,
          overlayPanel: null,
        },
      },
    })),
  dismissToast: (id) =>
    set((store) => ({
      game: {
        ...store.game,
        ui: {
          ...store.game.ui,
          toastQueue: store.game.ui.toastQueue.filter((toast) => toast.id !== id),
        },
      },
    })),
  shouldAutoAdvance: () => {
    const game = get().game;

    if (!game.ui.started || !game.ui.autoProgress || game.phase === 'tournament_complete') {
      return false;
    }

    if (AUTO_ADVANCE_PHASES.includes(game.phase)) {
      return true;
    }

    if (ACTION_PHASES.includes(game.phase)) {
      const actingSeat = selectActingSeat(game);
      return Boolean(actingSeat && !actingSeat.isHuman);
    }

    return false;
  },
}));
