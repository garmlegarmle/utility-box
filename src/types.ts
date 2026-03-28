export type SiteLang = 'en' | 'ko';
export type SiteSection = 'blog' | 'tools' | 'games' | 'pages';
export type CardTitleSize = 'auto' | 'default' | 'compact' | 'tight' | 'ultra-tight';

export interface CardData {
  title: string;
  category: string;
  tag: string;
  rank: string | null;
  rankNumber: number | null;
  imageId: number | null;
  imageUrl: string | null;
  titleSize: CardTitleSize;
}

export interface PostItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_md: string;
  content_before_md: string | null;
  content_after_md: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
  lang: SiteLang;
  section: SiteSection;
  pair_slug: string | null;
  view_count: number;
  tags: string[];
  meta: {
    title: string | null;
    description: string | null;
  };
  og: {
    title: string | null;
    description: string | null;
    imageUrl: string | null;
  };
  schemaType: 'BlogPosting' | 'Service' | null;
  cover: { id: number; url: string } | null;
  card: CardData;
}

export interface PostListResponse {
  ok: true;
  items: PostItem[];
  page: number;
  limit: number;
  total: number;
}

export interface PostDetailResponse {
  ok: true;
  post: PostItem;
  tags: string[];
  cover: { id: number; url: string } | null;
  media: unknown[];
}

export interface SessionResponse {
  ok: true;
  authenticated: boolean;
  isAdmin: boolean;
  username: string | null;
}

export interface UploadResponse {
  ok: true;
  mediaId: number;
  keys: Record<string, string>;
  urls: Record<string, string>;
  variants: Array<{ variant: string; key: string; width: number; format: string }>;
}

export interface TagListResponse {
  ok: true;
  items: string[];
}

export interface TagCountItem {
  name: string;
  count: number;
}

export interface TagCountResponse {
  ok: true;
  items: TagCountItem[];
}

export interface TrendCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trend_state_label?: string;
  regime_label?: string;
  trend_strength_score: number;
  transition_risk_score: number;
  state_transition_probability_10d?: number | null;
  confidence_score: number;
  composite_trend_score?: number;
  ema20?: number | null;
  ema50?: number | null;
  sma200?: number | null;
  ichimoku_tenkan?: number | null;
  ichimoku_kijun?: number | null;
  ichimoku_cloud_a?: number | null;
  ichimoku_cloud_b?: number | null;
  macd_line?: number | null;
  macd_signal?: number | null;
  macd_hist?: number | null;
  rsi?: number | null;
}

export interface TrendPayload {
  meta: {
    ticker: string;
    as_of_date: string;
    config_source?: string;
    best_direction_family?: string | null;
    window_bars: number;
    window_start: string | null;
    window_end: string | null;
  };
  current_state: {
    trend_state_label: string;
    trend_state_label_ko: string;
    regime_label_internal?: string;
    trend_strength_score: number;
    trend_conviction_score: number;
    breakdown_risk_score?: number;
    breakdown_risk_label?: string;
    state_transition_probability_10d?: number;
    transition_risk_score: number;
    transition_risk_label: string;
    confidence_score: number;
    direction_score?: number;
    momentum_score?: number;
    volatility_regime_score?: number;
    volume_confirmation_score?: number;
    tags?: string[];
    summary_text: string;
    interpretation_text_en?: string;
    interpretation_text_ko: string;
    summary_brief_en?: string;
    summary_brief_ko?: string;
    summary_bullets_en?: string[];
    summary_bullets_ko?: string[];
    detail_sections_en?: string[];
    detail_sections_ko?: string[];
  };
  chart_200d: {
    candles: TrendCandle[];
  };
  raw_feature_snapshot?: Record<string, number | null>;
  indicator_snapshot?: Record<string, number | null>;
  component_scores?: Record<string, unknown>;
}

export interface TrendAnalysisResponse {
  ok: true;
  payload: TrendPayload;
}

export interface HoldemLeaderboardEntry {
  id: number;
  rank: number;
  playerName: string;
  finalPlace: number;
  levelReached: number;
  handNumber: number;
  playerWon: boolean;
  createdAt: string | null;
}

export interface HoldemStatsSummary {
  totalPlays: number;
  playerPlays: number;
}

export interface HoldemStatsResponse {
  ok: true;
  playerName: string | null;
  summary: HoldemStatsSummary;
  leaderboard: HoldemLeaderboardEntry[];
}

export interface HoldemPlayResponse extends HoldemStatsResponse {
  playCount: number;
  runToken: string;
}

export interface HoldemCompleteResponse extends HoldemStatsResponse {
  madeLeaderboard: boolean;
}

export interface HoldemCard {
  rank: number;
  suit: 'clubs' | 'diamonds' | 'hearts' | 'spades';
  code: string;
}

export type HoldemOnlineActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

export interface HoldemOnlineLegalAction {
  type: HoldemOnlineActionType;
  amount?: number;
  toCall?: number;
  min?: number;
  max?: number;
  isRaise?: boolean;
}

export interface HoldemOnlineTableSummary {
  tableId: string;
  label: string;
  status: 'waiting' | 'in_hand' | 'showdown' | 'tournament_complete';
  connectedCount: number;
  seatedCount: number;
  readyCount: number;
  handNumber: number;
  level: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
}

export interface HoldemOnlineParticipant {
  playerId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
  nextTournamentReady: boolean;
  seated: boolean;
  seatIndex: number | null;
}

export interface HoldemOnlineSeat {
  seatIndex: number;
  playerId: string;
  name: string;
  isHuman: boolean;
  stack: number;
  status: 'active' | 'busted';
  eliminationOrder: number | null;
  holeCards: HoldemCard[];
  hasFolded: boolean;
  isAllIn: boolean;
  hasShownCards: boolean;
  currentBet: number;
  totalCommitted: number;
  actedThisStreet: boolean;
  lastFullRaiseSeen: number;
  lastAction: string | null;
  lastActionAmount: number;
  winningsThisHand: number;
  position: string | null;
}

export interface HoldemOnlineLogEntry {
  id: string;
  handNumber: number;
  level: number;
  street: string;
  seatIndex: number;
  playerId: string;
  name: string;
  type: string;
  amount: number;
  text: string;
}

export interface HoldemTournamentResultEntry {
  playerId: string;
  playerName: string;
  finalPlace: number;
  playerWon: boolean;
  levelReached: number;
  handNumber: number;
  chipCount: number;
}

export interface HoldemTournamentResultSnapshot {
  id: string;
  completedAt: string;
  handNumber: number;
  level: number;
  entries: HoldemTournamentResultEntry[];
}

export interface HoldemOnlineTableSnapshot extends HoldemOnlineTableSummary {
  viewer: {
    playerId: string;
    displayName: string;
    connected: boolean;
    role: 'player' | 'eliminated' | 'spectator';
    ready: boolean;
    nextTournamentReady: boolean;
    seatIndex: number | null;
  };
  actionDeadlineAt: number | null;
  actingSeatIndex: number | null;
  actingPlayerName: string | null;
  totalPot: number;
  mainPot: number;
  sidePots: number[];
  communityCards: HoldemCard[];
  currentLevel: {
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
  } | null;
  buttonSeatIndex: number | null;
  smallBlindSeatIndex: number | null;
  bigBlindSeatIndex: number | null;
  handMessage: string | null;
  logs: HoldemOnlineLogEntry[];
  seats: HoldemOnlineSeat[];
  participants: HoldemOnlineParticipant[];
  legalActions: HoldemOnlineLegalAction[];
  amountToCall: number;
  lastTournamentResult: HoldemTournamentResultSnapshot | null;
}

export interface HoldemOnlineSessionResponse {
  ok: true;
  sessionToken: string;
  playerId: string;
  displayName: string;
}

export interface HoldemOnlineTablesResponse {
  ok: true;
  tables: HoldemOnlineTableSummary[];
}

export interface PostSaveSnapshot {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_md: string;
  content_before_md: string | null;
  content_after_md: string | null;
  status: 'draft' | 'published';
  lang: SiteLang;
  section: SiteSection;
  updated_at: string;
  tags: string[];
  meta: {
    title: string | null;
    description: string | null;
  };
  og: {
    title: string | null;
    description: string | null;
    imageUrl: string | null;
  };
  schemaType: 'BlogPosting' | 'Service' | null;
  card: CardData;
}
