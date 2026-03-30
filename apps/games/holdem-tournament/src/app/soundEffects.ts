import { useEffect, useRef } from 'react';
import { useGameStore } from 'holdem/app/store/useGameStore';

type HoldemSoundName = 'card' | 'bet' | 'pot';

const SOUND_SOURCES: Record<HoldemSoundName, string> = {
  card: '/holdem-sfx/card-2.wav',
  bet: '/holdem-sfx/bet_sound.wav',
  pot: '/holdem-sfx/pot_sound.wav',
};

const SOUND_VOLUMES: Record<HoldemSoundName, number> = {
  card: 0.34,
  bet: 0.42,
  pot: 0.44,
};

const SOUND_POOL_SIZES: Record<HoldemSoundName, number> = {
  card: 24,
  bet: 10,
  pot: 10,
};

type PreparedPools = Record<HoldemSoundName, HTMLAudioElement[]>;
type CursorMap = Record<HoldemSoundName, number>;

let preparedPools: PreparedPools | null = null;
let poolCursors: CursorMap = { card: 0, bet: 0, pot: 0 };

function ensurePreparedPools(): PreparedPools | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (preparedPools) {
    return preparedPools;
  }

  preparedPools = {
    card: [],
    bet: [],
    pot: [],
  };

  (Object.keys(SOUND_SOURCES) as HoldemSoundName[]).forEach((name) => {
    preparedPools![name] = Array.from({ length: SOUND_POOL_SIZES[name] }, () => {
      const audio = new Audio(SOUND_SOURCES[name]);
      audio.preload = 'auto';
      audio.volume = SOUND_VOLUMES[name];
      return audio;
    });
  });

  return preparedPools;
}

function playSound(name: HoldemSoundName) {
  const pools = ensurePreparedPools();
  if (!pools) {
    return;
  }

  const pool = pools[name];
  if (!pool || pool.length === 0) {
    return;
  }

  const audio = pool[poolCursors[name] % pool.length];
  poolCursors[name] = (poolCursors[name] + 1) % pool.length;

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = SOUND_VOLUMES[name];
    void audio.play().catch(() => undefined);
  } catch {
    // Ignore autoplay / decoding failures; effects are best-effort only.
  }
}

function playBurst(name: HoldemSoundName, count: number, spacingMs: number, initialDelayMs = 0) {
  if (typeof window === 'undefined') {
    return;
  }

  const burstCount = Math.max(0, Math.round(count));
  if (burstCount <= 0) {
    return;
  }

  for (let index = 0; index < burstCount; index += 1) {
    window.setTimeout(() => {
      playSound(name);
    }, initialDelayMs + index * spacingMs);
  }
}

export function useHoldemSoundActivation(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const prime = () => {
      const pools = ensurePreparedPools();
      if (!pools) {
        return;
      }

      Object.values(pools).flat().forEach((audio) => {
        audio.load();
      });
    };

    prime();
    window.addEventListener('pointerdown', prime, { passive: true });
    window.addEventListener('keydown', prime);

    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, [enabled]);
}

export function playCardSoundBurst(count: number, spacingMs = 115, initialDelayMs = 0) {
  playBurst('card', count, spacingMs, initialDelayMs);
}

export function playBetSoundBurst(count: number, spacingMs = 90, initialDelayMs = 0) {
  playBurst('bet', count, spacingMs, initialDelayMs);
}

export function playPotSoundBurst(count = 1, spacingMs = 180, initialDelayMs = 0) {
  playBurst('pot', count, spacingMs, initialDelayMs);
}

export function useHoldemAiSoundEffects(enabled: boolean) {
  const game = useGameStore((state) => state.game);
  const previousRef = useRef<{
    started: boolean;
    phase: typeof game.phase;
    handNumber: number;
  } | null>(null);

  useEffect(() => {
    const currentSummary = {
      started: game.ui.started,
      phase: game.phase,
      handNumber: game.hand.handNumber,
    };
    const previousSummary = previousRef.current;
    previousRef.current = currentSummary;

    if (!enabled || !currentSummary.started || !previousSummary || !previousSummary.started) {
      return;
    }

    if (previousSummary.phase === currentSummary.phase && previousSummary.handNumber === currentSummary.handNumber) {
      return;
    }

    switch (currentSummary.phase) {
      case 'deal_hole_cards':
        playCardSoundBurst(2, 105, 60);
        break;
      case 'deal_flop':
        playCardSoundBurst(3, 160, 110);
        break;
      case 'deal_turn':
      case 'deal_river':
        playCardSoundBurst(1, 120, 140);
        break;
      default:
        break;
    }
  }, [enabled, game]);
}
