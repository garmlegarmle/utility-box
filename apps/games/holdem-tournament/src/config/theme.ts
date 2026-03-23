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
  0: { top: '93%', left: '50%' },
  1: { top: '79%', left: '16%' },
  2: { top: '60%', left: '7%' },
  3: { top: '34%', left: '10%' },
  4: { top: '14%', left: '24%' },
  5: { top: '14%', left: '76%' },
  6: { top: '34%', left: '90%' },
  7: { top: '60%', left: '93%' },
  8: { top: '79%', left: '84%' },
};
