import type { ActionLogEntry, GameState, PlayerActionType, Street } from 'holdem/types/engine';

let logSequence = 0;

export function createLogEntry(
  state: Pick<GameState, 'hand' | 'currentLevel'>,
  seatIndex: number,
  playerId: string,
  name: string,
  street: Street,
  type: PlayerActionType,
  amount: number,
  text: string,
): ActionLogEntry {
  logSequence += 1;

  return {
    id: `log-${logSequence}`,
    handNumber: state.hand.handNumber,
    level: state.currentLevel.level,
    street,
    seatIndex,
    playerId,
    name,
    type,
    amount,
    text,
  };
}

export function appendLogEntry(state: GameState, entry: ActionLogEntry): void {
  state.log.push(entry);
}
