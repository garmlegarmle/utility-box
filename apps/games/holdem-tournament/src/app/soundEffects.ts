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
type PreparedBuffers = Partial<Record<HoldemSoundName, AudioBuffer>>;

let preparedPools: PreparedPools | null = null;
let poolCursors: CursorMap = { card: 0, bet: 0, pot: 0 };
let soundPoolsPrimed = false;
let synthAudioContext: AudioContext | null = null;
let preparedBuffers: PreparedBuffers = {};
let bufferLoadPromise: Promise<void> | null = null;

function ensureSynthAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (synthAudioContext) {
    return synthAudioContext;
  }

  const Ctor = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }

  synthAudioContext = new Ctor();
  return synthAudioContext;
}

function withRunningAudioContext(run: (context: AudioContext) => void) {
  const context = ensureSynthAudioContext();
  if (!context) {
    return;
  }

  const start = () => run(context);

  if (context.state === 'running') {
    start();
    return;
  }

  void context.resume().then(start).catch(() => undefined);
}

function scheduleTone(
  context: AudioContext,
  {
    at,
    frequency,
    endFrequency,
    duration,
    volume,
    type = 'triangle',
  }: {
    at: number;
    frequency: number;
    endFrequency?: number;
    duration: number;
    volume: number;
    type?: OscillatorType;
  },
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = Math.max(620, frequency * 2.1);

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  if (endFrequency && endFrequency > 0) {
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
  }

  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + Math.min(0.015, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);

  oscillator.start(at);
  oscillator.stop(at + duration + 0.01);
}

function playCheckTap(atOffset = 0) {
  withRunningAudioContext((context) => {
    const at = context.currentTime + atOffset;
    scheduleTone(context, {
      at,
      frequency: 210,
      endFrequency: 132,
      duration: 0.11,
      volume: 0.11,
      type: 'triangle',
    });
    scheduleTone(context, {
      at: at + 0.01,
      frequency: 360,
      endFrequency: 260,
      duration: 0.045,
      volume: 0.035,
      type: 'square',
    });
  });
}

function playTurnDing(atOffset = 0) {
  withRunningAudioContext((context) => {
    const at = context.currentTime + atOffset;
    scheduleTone(context, {
      at,
      frequency: 880,
      endFrequency: 880,
      duration: 0.24,
      volume: 0.08,
      type: 'sine',
    });
    scheduleTone(context, {
      at: at + 0.035,
      frequency: 1320,
      endFrequency: 1320,
      duration: 0.34,
      volume: 0.05,
      type: 'triangle',
    });
  });
}

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

function loadSoundBuffers() {
  const context = ensureSynthAudioContext();
  if (typeof window === 'undefined' || !context) {
    return Promise.resolve();
  }

  if (bufferLoadPromise) {
    return bufferLoadPromise;
  }

  bufferLoadPromise = Promise.all(
    (Object.keys(SOUND_SOURCES) as HoldemSoundName[]).map(async (name) => {
      if (preparedBuffers[name]) {
        return;
      }

      try {
        const response = await fetch(SOUND_SOURCES[name], { cache: 'force-cache' });
        const bytes = await response.arrayBuffer();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        preparedBuffers[name] = decoded;
      } catch {
        // Keep HTMLAudio fallback when fetch/decode fails.
      }
    }),
  )
    .then(() => undefined)
    .catch(() => undefined);

  return bufferLoadPromise;
}

function playSound(name: HoldemSoundName) {
  const context = ensureSynthAudioContext();
  const buffer = preparedBuffers[name];
  if (context && buffer) {
    if (context.state !== 'running') {
      void context.resume().then(() => playSound(name)).catch(() => undefined);
      return;
    }

    try {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = SOUND_VOLUMES[name];
      source.connect(gain);
      gain.connect(context.destination);
      source.start();
      return;
    } catch {
      // Fall back to HTMLAudio below.
    }
  }

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
      if (soundPoolsPrimed) {
        return;
      }

      const pools = ensurePreparedPools();
      if (!pools) {
        const context = ensureSynthAudioContext();
        if (context && context.state !== 'running') {
          void context.resume().catch(() => undefined);
        }
        soundPoolsPrimed = true;
        return;
      }

      Object.values(pools).flat().forEach((audio) => {
        audio.load();
      });
      const context = ensureSynthAudioContext();
      if (context && context.state !== 'running') {
        void context.resume().catch(() => undefined);
      }
      void loadSoundBuffers();
      soundPoolsPrimed = true;
    };

    prime();
    if (soundPoolsPrimed) {
      return;
    }

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

export function playCheckSoundBurst(count = 1, spacingMs = 135, initialDelayMs = 0) {
  if (typeof window === 'undefined') {
    return;
  }

  const burstCount = Math.max(0, Math.round(count));
  if (burstCount <= 0) {
    return;
  }

  for (let index = 0; index < burstCount; index += 1) {
    const baseDelay = initialDelayMs + index * spacingMs;
    window.setTimeout(() => playCheckTap(0), baseDelay);
    window.setTimeout(() => playCheckTap(0), baseDelay + 92);
  }
}

export function playTurnNotificationSound() {
  playTurnDing();
}

export function useHoldemAiSoundEffects(enabled: boolean) {
  const game = useGameStore((state) => state.game);
  const previousRef = useRef<{
    started: boolean;
    phase: typeof game.phase;
    handNumber: number;
    logLength: number;
    isHumanTurn: boolean;
  } | null>(null);

  useEffect(() => {
    const actingSeat = game.betting.actingSeatIndex === null
      ? null
      : game.seats.find((seat) => seat.seatIndex === game.betting.actingSeatIndex) || null;
    const isHumanTurn = Boolean(
      game.ui.started &&
        game.phase.endsWith('_action') &&
        actingSeat?.isHuman &&
        actingSeat.status === 'active',
    );
    const currentSummary = {
      started: game.ui.started,
      phase: game.phase,
      handNumber: game.hand.handNumber,
      logLength: game.log.length,
      isHumanTurn,
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

    if (currentSummary.isHumanTurn && !previousSummary.isHumanTurn) {
      playTurnNotificationSound();
    }

    if (currentSummary.logLength > previousSummary.logLength) {
      const newEntries = game.log.slice(previousSummary.logLength);
      const checkCount = newEntries.filter((entry) => entry.type === 'check').length;
      if (checkCount > 0) {
        playCheckSoundBurst(checkCount);
      }
    }
  }, [enabled, game]);
}
