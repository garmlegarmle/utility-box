import { useGameStore } from 'holdem/app/store/useGameStore';
import type { GameState } from 'holdem/types/engine';
import styles from 'holdem/components/modals/WinnerModal.module.css';

export function WinnerModal({ game }: { game: GameState }) {
  const restart = useGameStore((state) => state.restart);

  if (game.phase !== 'tournament_complete' || !game.tournamentCompletionReason) {
    return null;
  }

  const winner = game.seats.find((seat) => seat.playerId === game.tournamentWinnerId);
  const humanSeat = game.seats.find((seat) => seat.isHuman);
  const isGameOver = game.tournamentCompletionReason === 'human-busted';
  const isHumanWinner = Boolean(winner?.isHuman);
  const title = isGameOver ? '게임 오버' : isHumanWinner ? '토너먼트 우승!' : `${winner?.name ?? '알 수 없음'} 우승`;
  const copy = isGameOver
    ? `당신은 ${humanSeat?.eliminationOrder ?? '?'}위로 탈락했습니다. 새 토너먼트를 시작해 다시 도전할 수 있습니다.`
    : isHumanWinner
      ? `당신이 모든 칩을 가져가며 1위를 차지했습니다. 총 ${winner?.stack.toLocaleString()}칩으로 레벨 ${game.currentLevel.level}에서 토너먼트를 끝냈습니다.`
      : `${winner?.name ?? '알 수 없음'}이(가) 모든 칩을 가져가며 우승했습니다. 총 ${winner?.stack.toLocaleString()}칩으로 레벨 ${game.currentLevel.level}에서 토너먼트를 끝냈습니다.`;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <span className={styles.eyebrow}>{isGameOver ? '플레이어 탈락' : '토너먼트 종료'}</span>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.copy}>{copy}</p>
        <button className={styles.restartButton} onClick={() => restart()}>
          새 토너먼트 시작
        </button>
      </div>
    </div>
  );
}
