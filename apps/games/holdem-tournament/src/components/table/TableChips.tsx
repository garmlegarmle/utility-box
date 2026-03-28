import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MOBILE_TABLE_SEAT_LAYOUT, TABLE_SEAT_LAYOUT } from 'holdem/config/theme';
import type { GameState, Seat } from 'holdem/types/engine';
import styles from 'holdem/components/table/TableChips.module.css';

type ChipTone = 'white' | 'red' | 'blue' | 'yellow';

const CHIP_VALUES: Array<{ value: number; tone: ChipTone }> = [
  { value: 5000, tone: 'yellow' },
  { value: 1250, tone: 'blue' },
  { value: 250, tone: 'red' },
  { value: 50, tone: 'white' },
];

const CHIP_DISPLAY_ORDER: ChipTone[] = ['white', 'red', 'blue', 'yellow'];

const POT_STACK_TOP = {
  desktop: 47,
  mobile: 44,
};
const POT_STACK_LEFT = 50;

function parsePercent(value: string): number {
  return Number(value.replace('%', ''));
}

function interpolateTowardCenter(value: number, factor: number): number {
  return 50 + (value - 50) * factor;
}

function stackStyle(finalTop: number, finalLeft: number, originTop: number, originLeft: number) {
  return {
    ['--top' as const]: `${finalTop}%`,
    ['--left' as const]: `${finalLeft}%`,
    ['--from-x' as const]: `${originLeft - finalLeft}%`,
    ['--from-y' as const]: `${originTop - finalTop}%`,
  } as CSSProperties;
}

function buildChipTones(amount: number, maxChips = 6): ChipTone[] {
  let remainder = Math.max(0, Math.round(amount));
  const tones: ChipTone[] = [];

  for (const chip of CHIP_VALUES) {
    while (remainder >= chip.value && tones.length < maxChips) {
      tones.push(chip.tone);
      remainder -= chip.value;
    }
  }

  if (tones.length === 0) {
    tones.push('white');
  }

  if (remainder > 0 && tones.length < maxChips) {
    tones.push('white');
  }

  return tones.sort((left, right) => CHIP_DISPLAY_ORDER.indexOf(left) - CHIP_DISPLAY_ORDER.indexOf(right));
}

function renderChipRack(amount: number, maxChips = 6) {
  return buildChipTones(amount, maxChips).map((tone, index) => (
    <span key={`${tone}-${index}`} className={[styles.chip, styles[tone]].join(' ')} />
  ));
}

interface ChipEffect {
  id: string;
  kind: 'bet' | 'collect' | 'win';
  amount: number;
  fromTop: number;
  fromLeft: number;
  toTop: number;
  toLeft: number;
}

interface ChipSnapshot {
  handNumber: number;
  currentBets: Map<string, number>;
  winnings: Map<string, number>;
  currentBetTotal: number;
}

export interface ChipAnimationGameState {
  hand: Pick<GameState['hand'], 'handNumber' | 'completed'>;
  seats: Array<
    Pick<
      Seat,
      'playerId' | 'seatIndex' | 'currentBet' | 'winningsThisHand'
    >
  >;
}

function createSnapshot(game: ChipAnimationGameState): ChipSnapshot {
  return {
    handNumber: game.hand.handNumber,
    currentBets: new Map(game.seats.map((seat) => [seat.playerId, seat.currentBet])),
    winnings: new Map(game.seats.map((seat) => [seat.playerId, seat.winningsThisHand])),
    currentBetTotal: game.seats.reduce((sum, seat) => sum + seat.currentBet, 0),
  };
}

export function TableChips({
  game,
  totalPot,
  isMobileLayout = false,
}: {
  game: ChipAnimationGameState;
  totalPot: number;
  isMobileLayout?: boolean;
}) {
  const previousSnapshotRef = useRef<ChipSnapshot | null>(null);
  const [effects, setEffects] = useState<ChipEffect[]>([]);
  const currentBetTotal = game.seats.reduce((sum, seat) => sum + seat.currentBet, 0);
  const centeredPotAmount = Math.max(0, totalPot - currentBetTotal);
  const layout = isMobileLayout ? MOBILE_TABLE_SEAT_LAYOUT : TABLE_SEAT_LAYOUT;
  const potStackTop = isMobileLayout ? POT_STACK_TOP.mobile : POT_STACK_TOP.desktop;

  useEffect(() => {
    const previous = previousSnapshotRef.current;
    const nextSnapshot = createSnapshot(game);
    previousSnapshotRef.current = nextSnapshot;

    if (!previous) {
      return;
    }

    const pendingEffects: ChipEffect[] = [];

    game.seats.forEach((seat) => {
      const previousBet = previous.currentBets.get(seat.playerId) ?? 0;
      const previousWinnings = previous.winnings.get(seat.playerId) ?? 0;
      const seatPosition = layout[seat.seatIndex] ?? layout[0]!;
      const seatTop = parsePercent(seatPosition.top);
      const seatLeft = parsePercent(seatPosition.left);
      const betTop = interpolateTowardCenter(seatTop, isMobileLayout ? 0.5 : 0.58);
      const betLeft = interpolateTowardCenter(seatLeft, isMobileLayout ? 0.5 : 0.58);
      const winTop = interpolateTowardCenter(seatTop, isMobileLayout ? 0.78 : 0.82);
      const winLeft = interpolateTowardCenter(seatLeft, isMobileLayout ? 0.78 : 0.82);

      if (seat.currentBet > previousBet) {
        pendingEffects.push({
          id: `${game.hand.handNumber}-${seat.playerId}-bet-${seat.currentBet}-${Date.now()}`,
          kind: 'bet',
          amount: seat.currentBet - previousBet,
          fromTop: seatTop,
          fromLeft: seatLeft,
          toTop: betTop,
          toLeft: betLeft,
        });
      }

      if (seat.winningsThisHand > previousWinnings) {
        pendingEffects.push({
          id: `${game.hand.handNumber}-${seat.playerId}-win-${seat.winningsThisHand}-${Date.now()}`,
          kind: 'win',
          amount: seat.winningsThisHand - previousWinnings,
          fromTop: potStackTop,
          fromLeft: POT_STACK_LEFT,
          toTop: winTop,
          toLeft: winLeft,
        });
      }
    });

    if (previous.currentBetTotal > 0 && nextSnapshot.currentBetTotal === 0) {
      game.seats.forEach((seat) => {
        const previousBet = previous.currentBets.get(seat.playerId) ?? 0;

        if (previousBet <= 0) {
          return;
        }

        const seatPosition = layout[seat.seatIndex] ?? layout[0]!;
        const seatTop = parsePercent(seatPosition.top);
        const seatLeft = parsePercent(seatPosition.left);
        const betTop = interpolateTowardCenter(seatTop, isMobileLayout ? 0.5 : 0.58);
        const betLeft = interpolateTowardCenter(seatLeft, isMobileLayout ? 0.5 : 0.58);

        pendingEffects.push({
          id: `${game.hand.handNumber}-${seat.playerId}-collect-${previousBet}-${Date.now()}`,
          kind: 'collect',
          amount: previousBet,
          fromTop: betTop,
          fromLeft: betLeft,
          toTop: potStackTop,
          toLeft: POT_STACK_LEFT,
        });
      });
    }

    if (pendingEffects.length === 0) {
      return;
    }

    setEffects((current) => [...current, ...pendingEffects]);

    pendingEffects.forEach((effect) => {
      window.setTimeout(() => {
        setEffects((current) => current.filter((entry) => entry.id !== effect.id));
      }, effect.kind === 'win' ? 1260 : effect.kind === 'collect' ? 1040 : 900);
    });
  }, [game, isMobileLayout, layout, potStackTop]);

  return (
    <div className={styles.layer}>
      {game.seats.map((seat) => {
        if (seat.currentBet <= 0) {
          return null;
        }

        const seatPosition = layout[seat.seatIndex] ?? layout[0]!;
        const seatTop = parsePercent(seatPosition.top);
        const seatLeft = parsePercent(seatPosition.left);
        const top = interpolateTowardCenter(seatTop, isMobileLayout ? 0.5 : 0.58);
        const left = interpolateTowardCenter(seatLeft, isMobileLayout ? 0.5 : 0.58);

        return (
          <div
            key={`${game.hand.handNumber}-${seat.playerId}-${seat.currentBet}`}
            className={[styles.stack, styles.betStack].join(' ')}
            style={stackStyle(top, left, seatTop, seatLeft)}
          >
            <div className={styles.chips}>{renderChipRack(seat.currentBet, 5)}</div>
            <span className={styles.amount}>{seat.currentBet}</span>
          </div>
        );
      })}

      {centeredPotAmount > 0 && (
        <div
          key={`${game.hand.handNumber}-pot-${centeredPotAmount}`}
          className={[styles.stack, styles.potStack].join(' ')}
          style={stackStyle(potStackTop, POT_STACK_LEFT, 50, 50)}
        >
          <div className={styles.chips}>{renderChipRack(centeredPotAmount, 7)}</div>
        </div>
      )}

      {game.hand.completed &&
        game.seats.map((seat) => {
          if (seat.winningsThisHand <= 0) {
            return null;
          }

          const seatPosition = layout[seat.seatIndex] ?? layout[0]!;
          const seatTop = parsePercent(seatPosition.top);
          const seatLeft = parsePercent(seatPosition.left);
          const top = interpolateTowardCenter(seatTop, isMobileLayout ? 0.78 : 0.82);
          const left = interpolateTowardCenter(seatLeft, isMobileLayout ? 0.78 : 0.82);

          return (
            <div
              key={`${game.hand.handNumber}-${seat.playerId}-win-${seat.winningsThisHand}`}
              className={[styles.stack, styles.winStack].join(' ')}
              style={stackStyle(top, left, potStackTop, POT_STACK_LEFT)}
            >
              <div className={styles.chips}>{renderChipRack(seat.winningsThisHand, 6)}</div>
              <span className={styles.amount}>+{seat.winningsThisHand}</span>
            </div>
          );
        })}

      {effects.map((effect) => (
        <div
          key={effect.id}
          className={[styles.stack, styles.effectStack, styles[`effect${effect.kind[0]!.toUpperCase()}${effect.kind.slice(1)}`]].join(' ')}
          style={{
            ['--from-top' as const]: `${effect.fromTop}%`,
            ['--from-left' as const]: `${effect.fromLeft}%`,
            ['--to-top' as const]: `${effect.toTop}%`,
            ['--to-left' as const]: `${effect.toLeft}%`,
          } as CSSProperties}
        >
          <div className={styles.chips}>{renderChipRack(effect.amount, 4)}</div>
        </div>
      ))}
    </div>
  );
}
