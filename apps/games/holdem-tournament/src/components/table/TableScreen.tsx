import { useEffect, useState } from 'react';
import { getStreetLabel } from 'holdem/config/localization';
import { useGameStore } from 'holdem/app/store/useGameStore';
import { BettingControls } from 'holdem/components/betting/BettingControls';
import { CommunityCards } from 'holdem/components/cards/CommunityCards';
import { BotProfileIntro } from 'holdem/components/modals/BotProfileIntro';
import { WinnerModal } from 'holdem/components/modals/WinnerModal';
import { CompactStatus, LogPanel, SettingsPanel } from 'holdem/components/panels/InfoPanels';
import { HeroHud } from 'holdem/components/seat/HeroHud';
import { SeatView } from 'holdem/components/seat/SeatView';
import { CenterPopup } from 'holdem/components/ui/CenterPopup';
import { ToastStack } from 'holdem/components/ui/ToastStack';
import { useIsMobileTableLayout } from 'holdem/hooks/useIsMobileTableLayout';
import {
  selectActingSeat,
  selectBigBlindSeatIndex,
  selectHumanAmountToCall,
  selectHumanLegalActions,
  selectHumanSeat,
  selectMainPot,
  selectSidePots,
  selectSmallBlindSeatIndex,
  selectTotalPot,
} from 'holdem/engine/stateMachine/selectors';
import { TableChips } from 'holdem/components/table/TableChips';
import styles from 'holdem/components/table/TableScreen.module.css';

interface TableScreenProps {
  layoutMode?: 'fullscreen' | 'embedded';
}

export function TableScreen({ layoutMode = 'fullscreen' }: TableScreenProps) {
  const [showBotProfileIntro, setShowBotProfileIntro] = useState(false);
  const game = useGameStore((state) => state.game);
  const startTournament = useGameStore((state) => state.startTournament);
  const advanceOneStep = useGameStore((state) => state.advanceOneStep);
  const openOverlayPanel = useGameStore((state) => state.openOverlayPanel);
  const closeOverlayPanel = useGameStore((state) => state.closeOverlayPanel);
  const isMobileLayout = useIsMobileTableLayout();
  const humanSeat = selectHumanSeat(game);
  const actingSeat = selectActingSeat(game);
  const legalActions = selectHumanLegalActions(game);
  const amountToCall = selectHumanAmountToCall(game);
  const mainPot = selectMainPot(game);
  const sidePots = selectSidePots(game);
  const totalPot = selectTotalPot(game);
  const smallBlindSeatIndex = selectSmallBlindSeatIndex(game);
  const bigBlindSeatIndex = selectBigBlindSeatIndex(game);

  useEffect(() => {
    setShowBotProfileIntro(false);
  }, [game.ui.lastSeed]);

  return (
    <div
      className={[
        styles.page,
        layoutMode === 'embedded' ? styles.embeddedPage : '',
        isMobileLayout ? styles.mobilePage : '',
      ].join(' ')}
    >
      <div className={styles.headerBar}>
        <CompactStatus game={game} />
        <div className={styles.headerButtons}>
          <button className={styles.headerButton} onClick={() => openOverlayPanel('history')}>
            핸드 히스토리
          </button>
          <button className={styles.headerButton} onClick={() => openOverlayPanel('settings')}>
            설정
          </button>
        </div>
      </div>

      <main className={styles.mainStage}>
        <section className={styles.tableWrap}>
          <div className={[styles.tableArena, isMobileLayout ? styles.mobileTableArena : ''].join(' ')}>
            <div className={styles.tableSurface}>
              <div className={styles.innerGuide} />
              <div className={styles.boardZone}>
                <div className={styles.potPanel}>
                  <span className={styles.potLabel}>메인 팟</span>
                  <strong className={styles.potValue}>{mainPot.toLocaleString()}</strong>
                  {sidePots.length > 0 && (
                    <div className={styles.sidePots}>
                      {sidePots.map((amount, index) => (
                        <span key={index}>사이드 팟 {index + 1}: {amount.toLocaleString()}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.potMetaStrip}>
                  <span>앤티 {game.currentLevel.ante} · BB {game.currentLevel.bigBlind}</span>
                  <span>라운드 {game.hand.handNumber}</span>
                </div>
                <div className={styles.communityBoard}>
                  <CommunityCards cards={game.hand.communityCards} handNumber={game.hand.handNumber} />
                </div>
                <div className={styles.handMessage}>
                  {game.hand.winnerMessage ??
                    (!actingSeat?.isHuman && actingSeat ? `${actingSeat.name} 차례 · ${getStreetLabel(game.betting.street)}` : '')}
                </div>
              </div>
            </div>
            {game.seats.map((seat) => (
              <SeatView
                key={seat.playerId}
                seat={seat}
                handNumber={game.hand.handNumber}
                isActing={seat.seatIndex === actingSeat?.seatIndex}
                isButton={seat.seatIndex === game.buttonSeatIndex}
                isSmallBlind={seat.seatIndex === smallBlindSeatIndex}
                isBigBlind={seat.seatIndex === bigBlindSeatIndex}
                showCards={
                  seat.isHuman ||
                  seat.hasShownCards ||
                  (game.phase === 'tournament_complete' && game.tournamentCompletionReason === 'winner')
                }
                showHoleCards={!seat.isHuman}
                isMobileLayout={isMobileLayout}
              />
            ))}
            <TableChips game={game} totalPot={totalPot} isMobileLayout={isMobileLayout} />
          </div>
        </section>

        <section className={styles.controlDock}>
          <div className={styles.bottomRail}>
            <div className={styles.leftDock}>
              {game.phase === 'next_hand' ? (
                <div className={styles.nextHandCard}>
                  <div className={styles.nextHandText}>현재 핸드가 종료되었습니다. 준비되면 다음 핸드를 시작하세요.</div>
                  <button className={styles.nextHandButton} onClick={advanceOneStep}>
                    다음 핸드 시작
                  </button>
                </div>
              ) : (
                <BettingControls
                  seat={humanSeat}
                  legalActions={legalActions}
                  amountToCall={amountToCall}
                  potSize={totalPot}
                  bigBlind={game.currentLevel.bigBlind}
                />
              )}
            </div>

            <div className={styles.rightDock}>
              <HeroHud
                seat={humanSeat}
                handNumber={game.hand.handNumber}
                isButton={humanSeat?.seatIndex === game.buttonSeatIndex}
                isSmallBlind={humanSeat?.seatIndex === smallBlindSeatIndex}
                isBigBlind={humanSeat?.seatIndex === bigBlindSeatIndex}
              />
            </div>
          </div>
        </section>
      </main>

      {!game.ui.started && !showBotProfileIntro && (
        <div className={styles.startOverlay}>
          <div className={styles.startCard}>
            <span className={styles.startEyebrow}>싱글 테이블 토너먼트</span>
            <h1 className={styles.startTitle}>노리밋 텍사스 홀덤</h1>
            <p className={styles.startCopy}>플레이어 9명, 시작 스택 10,000칩, 8핸드마다 블라인드 상승</p>
            <button className={styles.startButton} onClick={() => setShowBotProfileIntro(true)}>
              게임 시작
            </button>
          </div>
        </div>
      )}

      {!game.ui.started && showBotProfileIntro && (
        <BotProfileIntro
          onBack={() => setShowBotProfileIntro(false)}
          onConfirm={startTournament}
        />
      )}

      {game.ui.overlayPanel === 'settings' && (
        <CenterPopup title="설정" onClose={closeOverlayPanel}>
          <SettingsPanel game={game} />
        </CenterPopup>
      )}

      {game.ui.overlayPanel === 'history' && (
        <CenterPopup title="핸드 히스토리" onClose={closeOverlayPanel}>
          <LogPanel entries={game.log} />
        </CenterPopup>
      )}

      <WinnerModal game={game} />
      <ToastStack />
    </div>
  );
}
