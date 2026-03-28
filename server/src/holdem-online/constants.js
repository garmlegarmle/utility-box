export const HOLDEM_ONLINE_TABLE_IDS = ['table-1', 'table-2'];
export const HOLDEM_ONLINE_TABLE_LABELS = {
  'table-1': 'Table 1',
  'table-2': 'Table 2',
};

export const HOLDEM_ONLINE_MAX_PLAYERS = 9;
export const HOLDEM_ONLINE_MIN_READY_PLAYERS = 2;
export const HOLDEM_ONLINE_ACTION_TIMEOUT_MS = 15_000;
export const HOLDEM_ONLINE_DISCONNECT_GRACE_MS = 60_000;
export const HOLDEM_ONLINE_MAX_NAME_LENGTH = 24;
export const HOLDEM_ONLINE_HANDS_PER_LEVEL = 8;
export const HOLDEM_ONLINE_STARTING_STACK = 10_000;
export const HOLDEM_ONLINE_TABLE_SEAT_ORDER = [0, 5, 2, 7, 1, 6, 3, 8, 4];

export const HOLDEM_ONLINE_ACTION_PHASES = new Set([
  'preflop_action',
  'flop_action',
  'turn_action',
  'river_action',
]);

export const HOLDEM_ONLINE_AUTO_ADVANCE_PHASES = new Set([
  'tournament_init',
  'hand_setup',
  'post_antes',
  'post_blinds',
  'deal_hole_cards',
  'deal_flop',
  'deal_turn',
  'deal_river',
  'showdown',
  'award_pots',
  'eliminate_players',
  'move_button',
  'level_up_check',
  'next_hand',
]);
