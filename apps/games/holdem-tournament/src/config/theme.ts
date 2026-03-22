export interface SeatLayoutPosition {
  top: string;
  left: string;
}

export const TABLE_SEAT_LAYOUT: Record<number, SeatLayoutPosition> = {
  0: { top: '97%', left: '50%' },
  1: { top: '83%', left: '10%' },
  2: { top: '54%', left: '0%' },
  3: { top: '18%', left: '10%' },
  4: { top: '7%', left: '27%' },
  5: { top: '7%', left: '73%' },
  6: { top: '18%', left: '90%' },
  7: { top: '54%', left: '100%' },
  8: { top: '83%', left: '90%' },
};

export const MOBILE_TABLE_SEAT_LAYOUT: Record<number, SeatLayoutPosition> = {
  0: { top: '92%', left: '50%' },
  1: { top: '76%', left: '12%' },
  2: { top: '57%', left: '6%' },
  3: { top: '35%', left: '11%' },
  4: { top: '16%', left: '28%' },
  5: { top: '16%', left: '72%' },
  6: { top: '35%', left: '89%' },
  7: { top: '57%', left: '94%' },
  8: { top: '76%', left: '88%' },
};
