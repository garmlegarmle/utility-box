import { useEffect } from 'react';
import { useGameStore } from 'holdem/app/store/useGameStore';
import styles from 'holdem/components/betting/BettingControls.module.css';
import type { LegalAction, Seat } from 'holdem/types/engine';

interface BettingControlsProps {
  seat?: Seat;
  legalActions: LegalAction[];
  amountToCall: number;
  potSize: number;
  bigBlind: number;
}

interface ShortcutOption {
  label: string;
  amount: number;
}

function buildShortcutOptions(
  wagerAction: Extract<LegalAction, { min: number; max: number }> | undefined,
  seat: Seat,
  amountToCall: number,
  potSize: number,
  bigBlind: number,
): ShortcutOption[] {
  if (!wagerAction) {
    return [];
  }

  const options: ShortcutOption[] = [];
  const add = (label: string, rawAmount: number) => {
    const amount = Math.max(wagerAction.min, Math.min(wagerAction.max, Math.round(rawAmount)));

    if (options.some((option) => option.amount === amount)) {
      return;
    }

    options.push({ label, amount });
  };

  [2, 2.5, 3, 4].forEach((multiplier) => add(`${multiplier}BB`, multiplier * bigBlind));
  [0.33, 0.5, 0.75, 1].forEach((ratio) =>
    add(`팟 ${Math.round(ratio * 100)}%`, seat.currentBet + amountToCall + potSize * ratio),
  );

  return options;
}

export function BettingControls({ seat, legalActions, amountToCall, potSize, bigBlind }: BettingControlsProps) {
  const raiseInput = useGameStore((state) => state.game.ui.raiseInput);
  const performHumanAction = useGameStore((state) => state.performHumanAction);
  const setRaiseInput = useGameStore((state) => state.setRaiseInput);

  const checkAction = legalActions.find((action) => action.type === 'check');
  const callAction = legalActions.find((action) => action.type === 'call');
  const foldAction = legalActions.find((action) => action.type === 'fold');
  const allInAction = legalActions.find((action) => action.type === 'all-in');
  const wagerAction = legalActions.find(
    (action): action is Extract<LegalAction, { min: number; max: number }> => 'min' in action,
  );
  const shortcutOptions = seat ? buildShortcutOptions(wagerAction, seat, amountToCall, potSize, bigBlind) : [];

  useEffect(() => {
    if (wagerAction) {
      const clamped = Math.max(wagerAction.min, Math.min(wagerAction.max, raiseInput));

      if (clamped !== raiseInput) {
        setRaiseInput(clamped);
      }
    }
  }, [raiseInput, setRaiseInput, wagerAction]);

  if (!seat || seat.status !== 'active') {
    return <div className={styles.disabled}>토너먼트에서 탈락했습니다.</div>;
  }

  return (
    <div className={styles.controls}>
      {wagerAction ? (
        <div className={styles.raisePanel}>
          <label className={styles.label}>
            {wagerAction.type === 'bet' ? '베팅 금액' : '레이즈 금액'}
            {shortcutOptions.length > 0 && (
              <div className={styles.shortcutRow}>
                {shortcutOptions.map((option) => (
                  <button
                    key={`${option.label}-${option.amount}`}
                    type="button"
                    className={styles.shortcutButton}
                    onClick={() => setRaiseInput(option.amount)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            <input
              type="range"
              min={wagerAction.min}
              max={wagerAction.max}
              step={1}
              value={Math.max(wagerAction.min, Math.min(wagerAction.max, raiseInput))}
              onChange={(event) => setRaiseInput(Number(event.target.value))}
            />
          </label>
          <input
            className={styles.numeric}
            type="number"
            min={wagerAction.min}
            max={wagerAction.max}
            value={Math.max(wagerAction.min, Math.min(wagerAction.max, raiseInput))}
            onChange={(event) => setRaiseInput(Number(event.target.value))}
          />
        </div>
      ) : (
        <div className={styles.raisePanelPlaceholder}>현재 베팅 또는 레이즈는 불가능합니다.</div>
      )}
      <div className={styles.buttons}>
        {foldAction && (
          <button className={styles.secondary} onClick={() => performHumanAction('fold')}>
            폴드
          </button>
        )}
        {checkAction && (
          <button className={styles.secondary} onClick={() => performHumanAction('check')}>
            체크
          </button>
        )}
        {callAction && (
          <button className={styles.secondary} onClick={() => performHumanAction('call')}>
            콜 {callAction.amount.toLocaleString()}
          </button>
        )}
        {wagerAction && (
          <button className={styles.primary} onClick={() => performHumanAction(wagerAction.type, raiseInput)}>
            {wagerAction.type === 'bet' ? '베팅' : '레이즈'} {raiseInput.toLocaleString()}
          </button>
        )}
        {allInAction && (
          <button className={styles.danger} onClick={() => performHumanAction('all-in')}>
            올인 {allInAction.amount.toLocaleString()}
          </button>
        )}
      </div>
    </div>
  );
}
