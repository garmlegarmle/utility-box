import { useEffect, useState } from 'react';
import { getGameUiText, getStreetLabel } from 'holdem/config/localization';
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
  lang?: 'en' | 'ko';
  playerName?: string;
  skipNamePrompt?: boolean;
  onPlayerNameChange?: (value: string) => void;
  onTournamentStart?: (playerName: string) => void;
}

const START_COPY = {
  en: {
    mode: 'Single-table tournament',
    title: "No-Limit Texas Hold'em",
    subtitle: 'Nine players, 10,000 starting chips, blind levels every 8 hands.',
    inputLabel: 'Player name',
    inputPlaceholder: 'Enter your display name',
    start: 'Start game',
    enterName: 'Enter your name to start the tournament.',
    confirm: 'Review table',
  },
  ko: {
    mode: '싱글 테이블 토너먼트',
    title: '노리밋 텍사스 홀덤',
    subtitle: '플레이어 9명, 시작 스택 10,000칩, 8핸드마다 블라인드 상승',
    inputLabel: '플레이어 이름',
    inputPlaceholder: '표시할 이름을 입력하세요',
    start: '게임 시작',
    enterName: '토너먼트를 시작하려면 이름을 입력하세요.',
    confirm: '테이블 확인',
  },
} as const;

export function TableScreen({
  layoutMode = 'fullscreen',
  lang = 'ko',
  playerName = '',
  skipNamePrompt = false,
  onPlayerNameChange,
  onTournamentStart,
}: TableScreenProps) {
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
  const copy = START_COPY[lang];
  const uiCopy = getGameUiText(lang);
  const normalizedPlayerName = playerName.replace(/\s+/g, ' ').trim().slice(0, 24);

  useEffect(() => {
    setShowBotProfileIntro(false);
  }, [game.ui.lastSeed]);

  function handleStartConfirm() {
    if (!normalizedPlayerName) {
      return;
    }

    startTournament(normalizedPlayerName, lang);
    onTournamentStart?.(normalizedPlayerName);
  }

  return (
    <div
      className={[
        styles.page,
        layoutMode === 'embedded' ? styles.embeddedPage : '',
        isMobileLayout ? styles.mobilePage : '',
      ].join(' ')}
    >
      <div className={styles.headerBar}>
        <CompactStatus game={game} lang={lang} />
        <div className={styles.headerButtons}>
          <button className={styles.headerButton} onClick={() => openOverlayPanel('history')}>
            {uiCopy.handHistory}
          </button>
          <button className={styles.headerButton} onClick={() => openOverlayPanel('settings')}>
            {uiCopy.settings}
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
                  <span className={styles.potLabel}>{uiCopy.mainPot}</span>
                  <strong className={styles.potValue}>{mainPot.toLocaleString()}</strong>
                  {sidePots.length > 0 && (
                    <div className={styles.sidePots}>
                      {sidePots.map((amount, index) => (
                        <span key={index}>{uiCopy.sidePot(index + 1)}: {amount.toLocaleString()}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.potMetaStrip}>
                  <span>{uiCopy.ante} {game.currentLevel.ante} · BB {game.currentLevel.bigBlind}</span>
                  <span>{uiCopy.round} {game.hand.handNumber}</span>
                </div>
                <div className={styles.communityBoard}>
                  <CommunityCards cards={game.hand.communityCards} handNumber={game.hand.handNumber} />
                </div>
                <div className={styles.handMessage}>
                  {game.hand.winnerMessage ??
                    (!actingSeat?.isHuman && actingSeat ? uiCopy.actingTurn(actingSeat.name, getStreetLabel(game.betting.street, lang)) : '')}
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
                lang={lang}
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
                  <div className={styles.nextHandText}>{uiCopy.nextHandReady}</div>
                  <button className={styles.nextHandButton} onClick={advanceOneStep}>
                    {uiCopy.nextHandStart}
                  </button>
                </div>
              ) : (
                <BettingControls
                  seat={humanSeat}
                  legalActions={legalActions}
                  amountToCall={amountToCall}
                  potSize={totalPot}
                  bigBlind={game.currentLevel.bigBlind}
                  lang={lang}
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
                lang={lang}
              />
            </div>
          </div>
        </section>
      </main>

      {!game.ui.started && !showBotProfileIntro && (
        <div className={styles.startOverlay}>
          <div className={styles.startCard}>
            <span className={styles.startEyebrow}>{copy.mode}</span>
            <h1 className={styles.startTitle}>{copy.title}</h1>
            <p className={styles.startCopy}>{copy.subtitle}</p>
            {!skipNamePrompt ? (
              <>
                <label className={styles.startField}>
                  <span className={styles.startFieldLabel}>{copy.inputLabel}</span>
                  <input
                    className={styles.startInput}
                    type="text"
                    value={playerName}
                    maxLength={24}
                    placeholder={copy.inputPlaceholder}
                    onChange={(event) => onPlayerNameChange?.(event.target.value)}
                  />
                </label>
                {!normalizedPlayerName ? (
                  <p className={styles.startHint}>{copy.enterName}</p>
                ) : null}
              </>
            ) : null}
            <button
              className={styles.startButton}
              disabled={!normalizedPlayerName}
              onClick={() => setShowBotProfileIntro(true)}
            >
              {copy.confirm}
            </button>
          </div>
        </div>
      )}

      {!game.ui.started && showBotProfileIntro && (
        <BotProfileIntro
          lang={lang}
          onBack={() => setShowBotProfileIntro(false)}
          onConfirm={handleStartConfirm}
        />
      )}

      {game.ui.overlayPanel === 'settings' && (
        <CenterPopup title={uiCopy.settings} closeLabel={uiCopy.close} onClose={closeOverlayPanel}>
          <SettingsPanel game={game} lang={lang} />
        </CenterPopup>
      )}

      {game.ui.overlayPanel === 'history' && (
        <CenterPopup title={uiCopy.handHistory} closeLabel={uiCopy.close} onClose={closeOverlayPanel}>
          <LogPanel entries={game.log} lang={lang} />
        </CenterPopup>
      )}

      <WinnerModal game={game} lang={lang} />
      <ToastStack />
    </div>
  );
}
