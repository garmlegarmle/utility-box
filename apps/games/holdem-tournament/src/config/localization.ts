import type { BotProfileId } from 'holdem/types/ai';
import type { Street } from 'holdem/types/engine';

export type HoldemLang = 'en' | 'ko';

const STREET_LABELS: Record<HoldemLang, Record<Street, string>> = {
  en: {
    preflop: 'Preflop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
  },
  ko: {
    preflop: '프리플랍',
    flop: '플랍',
    turn: '턴',
    river: '리버',
    showdown: '쇼다운',
  },
};

const PROFILE_COPY: Record<BotProfileId, Record<HoldemLang, { name: string; description: string }>> = {
  'tight-passive': {
    en: { name: 'Tight Passive', description: 'Waits for strong hands and prefers calling over raising.' },
    ko: { name: '타이트 패시브', description: '강한 카드만 기다리며 레이즈보다 콜을 선호한다.' },
  },
  'tight-aggressive': {
    en: { name: 'Tight Aggressive', description: 'Chooses spots carefully, then applies pressure with strong ranges.' },
    ko: { name: '타이트 어그레시브', description: '선택적으로 참가하지만 좋은 패에서는 강하게 압박한다.' },
  },
  'loose-passive': {
    en: { name: 'Loose Passive', description: 'Plays too many hands and calls far too often.' },
    ko: { name: '루즈 패시브', description: '너무 많은 핸드에 참가하고 지나치게 콜한다.' },
  },
  'loose-aggressive': {
    en: { name: 'Loose Aggressive', description: 'Pressures the table with wide ranges and high aggression.' },
    ko: { name: '루즈 어그레시브', description: '넓은 레인지와 강한 공격성으로 압박을 가한다.' },
  },
  'calling-station': {
    en: { name: 'Calling Station', description: 'Calls too often and hates folding pairs or draws.' },
    ko: { name: '콜링 스테이션', description: '콜을 너무 자주 하고 페어나 드로우를 잘 버리지 않는다.' },
  },
  nit: {
    en: { name: 'Nit', description: 'Extremely tight and disciplined, but usually easy to read.' },
    ko: { name: '니트', description: '매우 타이트하고 단단하지만 읽기 쉬운 스타일이다.' },
  },
  maniac: {
    en: { name: 'Maniac', description: 'Hyper-aggressive with very high raise and bluff frequencies.' },
    ko: { name: '매니악', description: '과도하게 공격적이며 레이즈와 블러프 빈도가 매우 높다.' },
  },
  'balanced-regular': {
    en: { name: 'Balanced Regular', description: 'The most stable and balanced all-around bot profile.' },
    ko: { name: '밸런스드 레귤러', description: '가장 안정적이고 균형 잡힌 기본형 봇이다.' },
  },
};

export const GAME_UI_TEXT = {
  en: {
    tournament: 'Tournament',
    level: 'Level',
    ante: 'Ante',
    hand: 'Hand',
    pot: 'Pot',
    waiting: 'Waiting',
    nextLevelInHands: (value: number) => `Next level in ${value} hands`,
    settings: 'Settings',
    handHistory: 'Hand history',
    mainPot: 'Main pot',
    sidePot: (index: number) => `Side pot ${index}`,
    round: 'Hand',
    actingTurn: (name: string, street: string) => `${name} to act · ${street}`,
    nextHandReady: 'The current hand is complete. Start the next hand when you are ready.',
    nextHandStart: 'Start next hand',
    aiSpeed: 'AI action speed',
    autoProgress: 'Auto progress',
    on: 'On',
    off: 'Off',
    stepOnce: 'Step once',
    restartTournament: 'Restart tournament',
    seed: 'Seed',
    opponentProfiles: 'Opponent profiles',
    tournamentEntrants: 'Tournament field',
    tournamentEntrantsCopy: 'These eight bot tendencies are in the field. Their exact identity stays hidden during play.',
    back: 'Back',
    confirmStart: 'Confirm and start',
    gameOver: 'Game over',
    tournamentWin: 'Tournament winner!',
    unknownPlayer: 'Unknown player',
    playerBusted: 'Player eliminated',
    tournamentComplete: 'Tournament complete',
    restartRun: 'Start a new tournament',
    chips: 'chips',
    folded: 'Folded',
    allIn: 'All-in',
    busted: 'Busted',
    winnerBadge: 'Winner!',
    uncontestedWinLabel: 'No showdown',
    currentBet: (value: number) => `Current bet: ${value.toLocaleString()}`,
    fold: 'Fold',
    check: 'Check',
    call: (value: number) => `Call ${value.toLocaleString()}`,
    bet: (value: number) => `Bet ${value.toLocaleString()}`,
    raise: (value: number) => `Raise ${value.toLocaleString()}`,
    allInAction: (value: number) => `All-in ${value.toLocaleString()}`,
    actionLogFold: (name: string) => `${name} folds`,
    actionLogCheck: (name: string) => `${name} checks`,
    actionLogCall: (name: string, amount: number) => `${name} calls ${amount.toLocaleString()}`,
    actionLogBet: (name: string, amount: number) => `${name} bets ${amount.toLocaleString()}`,
    actionLogRaise: (name: string, amount: number) => `${name} raises to ${amount.toLocaleString()}`,
    actionLogAllIn: (name: string, amount: number) => `${name} is all-in for ${amount.toLocaleString()}`,
    betAmount: 'Bet size',
    raiseAmount: 'Raise size',
    potShortcut: (ratioPercent: number) => `Pot ${ratioPercent}%`,
    noWagerAvailable: 'Betting or raising is not available in this spot.',
    eliminatedMessage: 'You are out of the tournament.',
    close: 'Close',
    noContestWinner: (name: string, totalPot: number) => `${name} wins ${totalPot.toLocaleString()} chips uncontested.`,
    showdownWinner: (name: string) => `${name} wins the hand.`,
    splitPotWinner: (names: string[]) => `${names.join(', ')} split the pot.`,
    forcedBetLabel: {
      'post-ante': 'Ante',
      'post-small-blind': 'Small blind',
      'post-big-blind': 'Big blind',
    },
    forcedBetLog: (name: string, label: string, posted: number) => `${name} - ${label} ${posted.toLocaleString()}`,
    handStartLog: (handNumber: number, buttonName: string | undefined, smallBlind: number, bigBlind: number, ante: number) =>
      `Hand #${handNumber} starts. Button: ${buttonName ?? 'Unknown'}. Blinds ${smallBlind}/${bigBlind}, ante ${ante}.`,
    boardRevealLog: (street: 'flop' | 'turn' | 'river', cards: string[]) =>
      `${street === 'flop' ? 'Flop' : street === 'turn' ? 'Turn' : 'River'}: ${cards.join(' ')}`,
    openCardsLog: (name: string, cards: string[]) => `${name} shows ${cards.join(' ')}`,
    winLog: (name: string, amount: number, potLabel: string, isOddChip: boolean) =>
      `${name} collects ${amount.toLocaleString()} chips (${potLabel}${isOddChip ? ', including the odd chip' : ''})`,
    eliminationLog: (name: string, place: number) => `${name} is eliminated (${formatPlacement(place, 'en')})`,
    levelToast: (level: number, smallBlind: number, bigBlind: number) =>
      `Level ${level} begins: ${smallBlind}/${bigBlind}`,
    winnerToast: (name: string) => `${name} wins the tournament`,
    winnerModalBusted: (place: number | string) =>
      `You busted in ${place}. Start a new tournament and take another shot.`,
    winnerModalHuman: (stack: number, level: number) =>
      `You took every chip on the table and finished 1st. You closed the tournament on level ${level} with ${stack.toLocaleString()} chips.`,
    winnerModalBot: (name: string, stack: number, level: number) =>
      `${name} finished with every chip in play. The tournament ended on level ${level} with ${stack.toLocaleString()} chips.`,
  },
  ko: {
    tournament: '토너먼트',
    level: '레벨',
    ante: '앤티',
    hand: '핸드',
    pot: '팟',
    waiting: '대기 중',
    nextLevelInHands: (value: number) => `다음 레벨 ${value}핸드`,
    settings: '설정',
    handHistory: '핸드 히스토리',
    mainPot: '메인 팟',
    sidePot: (index: number) => `사이드 팟 ${index}`,
    round: '라운드',
    actingTurn: (name: string, street: string) => `${name} 차례 · ${street}`,
    nextHandReady: '현재 핸드가 종료되었습니다. 준비되면 다음 핸드를 시작하세요.',
    nextHandStart: '다음 핸드 시작',
    aiSpeed: 'AI 액션 속도',
    autoProgress: '자동 진행',
    on: '켜짐',
    off: '꺼짐',
    stepOnce: '한 단계 진행',
    restartTournament: '토너먼트 다시 시작',
    seed: '시드',
    opponentProfiles: '상대 프로필',
    tournamentEntrants: '이번 토너먼트 참가자',
    tournamentEntrantsCopy: '이번 게임에는 아래 8가지 성향이 등장합니다. 누가 어떤 성향인지는 플레이 중 공개되지 않습니다.',
    back: '뒤로',
    confirmStart: '확인 후 시작',
    gameOver: '게임 오버',
    tournamentWin: '토너먼트 우승!',
    unknownPlayer: '알 수 없음',
    playerBusted: '플레이어 탈락',
    tournamentComplete: '토너먼트 종료',
    restartRun: '새 토너먼트 시작',
    chips: '칩',
    folded: '폴드',
    allIn: '올인',
    busted: '탈락',
    winnerBadge: '승리!',
    uncontestedWinLabel: '쇼다운 없음',
    currentBet: (value: number) => `현재 베팅: ${value.toLocaleString()}`,
    fold: '폴드',
    check: '체크',
    call: (value: number) => `콜 ${value.toLocaleString()}`,
    bet: (value: number) => `베팅 ${value.toLocaleString()}`,
    raise: (value: number) => `레이즈 ${value.toLocaleString()}`,
    allInAction: (value: number) => `올인 ${value.toLocaleString()}`,
    actionLogFold: (name: string) => `${name} 폴드`,
    actionLogCheck: (name: string) => `${name} 체크`,
    actionLogCall: (name: string, amount: number) => `${name} 콜 ${amount.toLocaleString()}`,
    actionLogBet: (name: string, amount: number) => `${name} 베팅 ${amount.toLocaleString()}`,
    actionLogRaise: (name: string, amount: number) => `${name} 레이즈 ${amount.toLocaleString()}`,
    actionLogAllIn: (name: string, amount: number) => `${name} 올인 ${amount.toLocaleString()}`,
    betAmount: '베팅 금액',
    raiseAmount: '레이즈 금액',
    potShortcut: (ratioPercent: number) => `팟 ${ratioPercent}%`,
    noWagerAvailable: '현재 베팅 또는 레이즈는 불가능합니다.',
    eliminatedMessage: '토너먼트에서 탈락했습니다.',
    close: '닫기',
    noContestWinner: (name: string, totalPot: number) => `${name}이(가) 승부 없이 ${totalPot.toLocaleString()} 칩을 가져갑니다.`,
    showdownWinner: (name: string) => `${name}이(가) 핸드를 가져갑니다.`,
    splitPotWinner: (names: string[]) => `${names.join(', ')}이(가) 팟을 나눠 가집니다.`,
    forcedBetLabel: {
      'post-ante': '앤티',
      'post-small-blind': '스몰 블라인드',
      'post-big-blind': '빅 블라인드',
    },
    forcedBetLog: (name: string, label: string, posted: number) => `${name} - ${label} ${posted.toLocaleString()}`,
    handStartLog: (handNumber: number, buttonName: string | undefined, smallBlind: number, bigBlind: number, ante: number) =>
      `핸드 #${handNumber} 시작. 버튼: ${buttonName ?? '알 수 없음'}. 블라인드 ${smallBlind}/${bigBlind}, 앤티 ${ante}`,
    boardRevealLog: (street: 'flop' | 'turn' | 'river', cards: string[]) =>
      `${street === 'flop' ? '플랍' : street === 'turn' ? '턴' : '리버'}: ${cards.join(' ')}`,
    openCardsLog: (name: string, cards: string[]) => `${name} 오픈 ${cards.join(' ')}`,
    winLog: (name: string, amount: number, potLabel: string, isOddChip: boolean) =>
      `${name} ${amount.toLocaleString()}칩 획득 (${potLabel}${isOddChip ? ', 나머지 1칩 포함' : ''})`,
    eliminationLog: (name: string, place: number) => `${name} 탈락 (${formatPlacement(place, 'ko')})`,
    levelToast: (level: number, smallBlind: number, bigBlind: number) =>
      `레벨 ${level} 시작: ${smallBlind}/${bigBlind}`,
    winnerToast: (name: string) => `${name} 우승`,
    winnerModalBusted: (place: number | string) =>
      `당신은 ${place}로 탈락했습니다. 새 토너먼트를 시작해 다시 도전할 수 있습니다.`,
    winnerModalHuman: (stack: number, level: number) =>
      `당신이 모든 칩을 가져가며 1위를 차지했습니다. 총 ${stack.toLocaleString()}칩으로 레벨 ${level}에서 토너먼트를 끝냈습니다.`,
    winnerModalBot: (name: string, stack: number, level: number) =>
      `${name}이(가) 모든 칩을 가져가며 우승했습니다. 총 ${stack.toLocaleString()}칩으로 레벨 ${level}에서 토너먼트를 끝냈습니다.`,
  },
} as const;

export function getGameUiText(lang: HoldemLang = 'ko') {
  return GAME_UI_TEXT[lang];
}

export function getStreetLabel(street: Street, lang: HoldemLang = 'ko'): string {
  return STREET_LABELS[lang][street];
}

export function getProfileLabel(profileId?: BotProfileId, lang: HoldemLang = 'ko'): string {
  if (!profileId) {
    return '';
  }

  return PROFILE_COPY[profileId][lang].name;
}

export function getProfileDescription(profileId?: BotProfileId, lang: HoldemLang = 'ko'): string {
  if (!profileId) {
    return '';
  }

  return PROFILE_COPY[profileId][lang].description;
}

export function getPotLabel(potId: string, lang: HoldemLang = 'ko'): string {
  const copy = getGameUiText(lang);

  if (potId === 'main') {
    return copy.mainPot;
  }

  if (potId.startsWith('side-')) {
    const index = Number(potId.replace('side-', ''));
    return copy.sidePot(index);
  }

  return potId;
}

export function formatWinningHandLabel(label: string | null | undefined, lang: HoldemLang = 'ko'): string | null {
  if (!label) {
    return null;
  }

  if (lang === 'en') {
    return label;
  }

  const trimmed = label.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'Royal Flush') {
    return '로열 플러시';
  }

  const straightFlushMatch = trimmed.match(/^([2-9TJQKA])-high Straight Flush$/);
  if (straightFlushMatch) {
    return `${straightFlushMatch[1]}하이 스트레이트 플러시`;
  }

  const fourKindMatch = trimmed.match(/^Four of a Kind, ([2-9TJQKA]+)s$/);
  if (fourKindMatch) {
    return `포카드, ${fourKindMatch[1]}`;
  }

  const fullHouseMatch = trimmed.match(/^Full House, ([2-9TJQKA]+)s full of ([2-9TJQKA]+)s$/);
  if (fullHouseMatch) {
    return `풀하우스, ${fullHouseMatch[1]} 풀 오브 ${fullHouseMatch[2]}`;
  }

  const flushMatch = trimmed.match(/^([2-9TJQKA])-high Flush$/);
  if (flushMatch) {
    return `${flushMatch[1]}하이 플러시`;
  }

  const straightMatch = trimmed.match(/^([2-9TJQKA])-high Straight$/);
  if (straightMatch) {
    return `${straightMatch[1]}하이 스트레이트`;
  }

  const tripsMatch = trimmed.match(/^Three of a Kind, ([2-9TJQKA]+)s$/);
  if (tripsMatch) {
    return `트리플, ${tripsMatch[1]}`;
  }

  const twoPairMatch = trimmed.match(/^Two Pair, ([2-9TJQKA]+)s and ([2-9TJQKA]+)s$/);
  if (twoPairMatch) {
    return `투페어, ${twoPairMatch[1]}와 ${twoPairMatch[2]}`;
  }

  const pairMatch = trimmed.match(/^Pair of ([2-9TJQKA]+)s$/);
  if (pairMatch) {
    return `원페어, ${pairMatch[1]}`;
  }

  const highCardMatch = trimmed.match(/^([2-9TJQKA])-high$/);
  if (highCardMatch) {
    return `${highCardMatch[1]}하이`;
  }

  return trimmed;
}

export function formatPlacement(value: number, lang: HoldemLang = 'ko') {
  if (lang === 'ko') {
    return `${value}위`;
  }

  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

export function formatChipStack(value: number, lang: HoldemLang = 'ko') {
  const copy = getGameUiText(lang);
  return `${value.toLocaleString()} ${copy.chips}`;
}
