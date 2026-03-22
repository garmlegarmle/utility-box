import { AI_PROFILES } from 'holdem/config/aiProfiles';
import type { BotProfileId } from 'holdem/types/ai';
import type { Street } from 'holdem/types/engine';

export const STREET_LABELS: Record<Street, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

export function getStreetLabel(street: Street): string {
  return STREET_LABELS[street];
}

export function getProfileLabel(profileId?: BotProfileId): string {
  if (!profileId) {
    return '';
  }

  return AI_PROFILES[profileId].name;
}

export function getPotLabel(potId: string): string {
  if (potId === 'main') {
    return '메인 팟';
  }

  if (potId.startsWith('side-')) {
    const index = Number(potId.replace('side-', ''));
    return `사이드 팟 ${index}`;
  }

  return potId;
}
