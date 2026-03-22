import { MOBILE_TABLE_SEAT_LAYOUT, TABLE_SEAT_LAYOUT } from 'holdem/config/theme';
import { CardView } from 'holdem/components/cards/CardView';
import type { Seat } from 'holdem/types/engine';
import styles from 'holdem/components/seat/SeatView.module.css';

interface SeatViewProps {
  seat: Seat;
  handNumber: number;
  isActing: boolean;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  showCards: boolean;
  showHoleCards?: boolean;
  isMobileLayout?: boolean;
}

export function SeatView({
  seat,
  handNumber,
  isActing,
  isButton,
  isSmallBlind,
  isBigBlind,
  showCards,
  showHoleCards = true,
  isMobileLayout = false,
}: SeatViewProps) {
  const layout = isMobileLayout ? MOBILE_TABLE_SEAT_LAYOUT : TABLE_SEAT_LAYOUT;
  const position = layout[seat.seatIndex] ?? layout[0]!;
  const isFoldedOut = seat.status === 'busted' || seat.hasFolded;

  return (
    <div
      className={[
        styles.seat,
        seat.isHuman ? styles.humanSeat : '',
        isFoldedOut ? styles.folded : styles.live,
        isActing ? styles.acting : '',
        seat.status === 'busted' ? styles.busted : '',
      ].join(' ')}
      style={{ top: position.top, left: position.left }}
    >
      <div className={styles.badges}>
        {isButton && <span className={styles.button}>D</span>}
        {isSmallBlind && <span className={styles.blind}>SB</span>}
        {isBigBlind && <span className={styles.blind}>BB</span>}
      </div>
      <div className={styles.nameRow}>
        <span className={styles.name}>{seat.name}</span>
      </div>
      <div className={styles.stack}>{seat.stack.toLocaleString()} 칩</div>
      {showHoleCards && (
        <div className={styles.cards}>
          {seat.holeCards.length > 0 ? (
            seat.holeCards.map((card, index) => (
              <CardView
                key={`${handNumber}-${seat.playerId}-${card.code}-${index}`}
                card={card}
                hidden={!showCards}
                hero={seat.isHuman}
                animate
                delayMs={seat.seatIndex * 42 + index * 90}
                motion="hole"
              />
            ))
          ) : (
            <>
              <CardView hidden />
              <CardView hidden />
            </>
          )}
        </div>
      )}
      <div className={styles.statusRow}>
        {seat.hasFolded && seat.status === 'active' && <span className={styles.status}>폴드</span>}
        {seat.isAllIn && seat.status === 'active' && <span className={styles.status}>올인</span>}
        {seat.status === 'busted' && <span className={styles.status}>탈락</span>}
      </div>
      <div className={styles.betRow}>{seat.currentBet > 0 ? `현재 베팅: ${seat.currentBet}` : ' '}</div>
    </div>
  );
}
