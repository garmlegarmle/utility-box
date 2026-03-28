import { MOBILE_TABLE_SEAT_LAYOUT, TABLE_SEAT_LAYOUT } from 'holdem/config/theme';
import { CardView } from 'holdem/components/cards/CardView';
import { formatChipStack, getGameUiText, type HoldemLang } from 'holdem/config/localization';
import type { Seat } from 'holdem/types/engine';
import styles from 'holdem/components/seat/SeatView.module.css';

interface SeatViewProps {
  seat: Seat;
  handNumber: number;
  isActing: boolean;
  isWinner?: boolean;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  showCards: boolean;
  showHoleCards?: boolean;
  isMobileLayout?: boolean;
  lang: HoldemLang;
}

export function SeatView({
  seat,
  handNumber,
  isActing,
  isWinner = false,
  isButton,
  isSmallBlind,
  isBigBlind,
  showCards,
  showHoleCards = true,
  isMobileLayout = false,
  lang,
}: SeatViewProps) {
  const layout = isMobileLayout ? MOBILE_TABLE_SEAT_LAYOUT : TABLE_SEAT_LAYOUT;
  const position = layout[seat.seatIndex] ?? layout[0]!;
  const isFoldedOut = seat.status === 'busted' || seat.hasFolded;
  const copy = getGameUiText(lang);

  return (
    <div
      className={[
        styles.seat,
        seat.isHuman ? styles.humanSeat : '',
        isFoldedOut ? styles.folded : styles.live,
        isActing ? styles.acting : '',
        isWinner ? styles.winner : '',
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
      <div className={styles.stack}>{formatChipStack(seat.stack, lang)}</div>
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
        {seat.hasFolded && seat.status === 'active' && <span className={styles.status}>{copy.folded}</span>}
        {seat.isAllIn && seat.status === 'active' && <span className={styles.status}>{copy.allIn}</span>}
        {seat.status === 'busted' && <span className={styles.status}>{copy.busted}</span>}
      </div>
      <div className={styles.betRow}>{seat.currentBet > 0 ? copy.currentBet(seat.currentBet) : ' '}</div>
    </div>
  );
}
