import type { Phase } from 'holdem/types/engine';

export const ACTION_PHASES: Phase[] = ['preflop_action', 'flop_action', 'turn_action', 'river_action'];

export const AUTO_ADVANCE_PHASES: Phase[] = [
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
];
