import { useGameStore } from 'holdem/app/store/useGameStore';
import { getStreetLabel } from 'holdem/config/localization';
import { selectActingSeat, selectHandsUntilLevelUp, selectTotalPot } from 'holdem/engine/stateMachine/selectors';
import type { ActionLogEntry, GameState } from 'holdem/types/engine';
import styles from 'holdem/components/panels/InfoPanels.module.css';

export function CompactStatus({ game }: { game: GameState }) {
  const actingSeat = selectActingSeat(game);
  const totalPot = selectTotalPot(game);
  const handsUntilLevelUp = selectHandsUntilLevelUp(game);

  return (
    <section className={styles.cornerStatus}>
      <div className={styles.cornerTitle}>토너먼트</div>
      <div className={styles.cornerLine}>
        <span>레벨 {game.currentLevel.level}</span>
        <span>
          {game.currentLevel.smallBlind}/{game.currentLevel.bigBlind}
        </span>
        <span>앤티 {game.currentLevel.ante}</span>
      </div>
      <div className={styles.cornerLine}>
        <span>핸드 #{game.hand.handNumber}</span>
        <span>팟 {totalPot.toLocaleString()}</span>
        <span>다음 레벨 {handsUntilLevelUp}핸드</span>
      </div>
      <div className={styles.cornerLine}>
        <span>{getStreetLabel(game.betting.street)}</span>
        <span>{actingSeat?.name ?? '대기 중'}</span>
      </div>
    </section>
  );
}

export function SettingsPanel({ game }: { game: GameState }) {
  const setActionSpeed = useGameStore((state) => state.setActionSpeed);
  const toggleAutoProgress = useGameStore((state) => state.toggleAutoProgress);
  const advanceOneStep = useGameStore((state) => state.advanceOneStep);
  const restart = useGameStore((state) => state.restart);

  return (
    <section className={styles.panel}>
      <h3 className={styles.title}>설정</h3>
      <label className={styles.sliderLabel}>
        AI 액션 속도: {game.ui.actionSpeed}ms
        <input
          type="range"
          min={150}
          max={1600}
          step={50}
          value={game.ui.actionSpeed}
          onChange={(event) => setActionSpeed(Number(event.target.value))}
        />
      </label>
      <button className={styles.toggle} onClick={toggleAutoProgress}>
        자동 진행: {game.ui.autoProgress ? '켜짐' : '꺼짐'}
      </button>
      {!game.ui.autoProgress && (
        <button className={styles.secondary} onClick={advanceOneStep}>
          한 단계 진행
        </button>
      )}
      <button className={styles.secondary} onClick={() => restart()}>
        토너먼트 다시 시작
      </button>
      <div className={styles.seed}>시드: {game.ui.lastSeed || game.rngState}</div>
    </section>
  );
}

export function LogPanel({ entries }: { entries: ActionLogEntry[] }) {
  return (
    <section className={styles.panel}>
      <h3 className={styles.title}>핸드 히스토리</h3>
      <div className={styles.logList}>
        {entries.slice().reverse().map((entry) => (
          <div key={entry.id} className={styles.logEntry}>
            <span className={styles.logStreet}>{getStreetLabel(entry.street)}</span>
            <span>{entry.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
