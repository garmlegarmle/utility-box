# Single-Player No-Limit Texas Hold'em Tournament

Browser-based single-table tournament poker game built with React, TypeScript, Vite, Zustand, and Vitest.

## Features

- 1 human player and 8 local rule-based AI opponents
- No-Limit Texas Hold'em tournament flow with eliminations and heads-up transition
- Config-driven blind structure, stacks, seating, bet sizes, and AI personalities
- Pure engine modules for deck handling, betting, side pots, showdown, and tournament advancement
- Rule-based bot system with distinct archetypes:
  - Tight Passive
  - Tight Aggressive
  - Loose Passive
  - Loose Aggressive
  - Calling Station
  - Nit
  - Maniac
  - Balanced Regular
- Modular placeholder UI designed to be reskinned later with card, chip, avatar, and felt assets
- Hand history panel, AI speed control, auto-progress toggle, restart flow, and toast/modal feedback

## Stack

- React
- TypeScript
- Vite
- Zustand
- CSS Modules
- Vitest

## Getting Started

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Scripts

```bash
npm run dev
npm run build
npm test
```

## Embedding / GA-ML Porting

이 프로젝트는 기존 웹페이지에 붙이기 쉽도록 `임베드용 진입점`이 준비되어 있습니다.

- React 컴포넌트: [src/embed.tsx](/Users/gamlebae/Desktop/game%20test/src/embed.tsx)
- 재사용 export: [src/index.ts](/Users/gamlebae/Desktop/game%20test/src/index.ts)
- GA-ML 이식 가이드: [GA_ML_INTEGRATION.md](/Users/gamlebae/Desktop/game%20test/GA_ML_INTEGRATION.md)

핵심 포인트:

- 풀스크린 전용 `body` 스타일은 [fullscreen.css](/Users/gamlebae/Desktop/game%20test/src/styles/fullscreen.css)로 분리됨
- 임베드 모드에서는 게임 스타일이 `.holdem-app-theme` 아래로만 적용됨
- `HoldemTournamentEmbed` 또는 `mountHoldemTournament(...)`로 호스트 페이지에 붙일 수 있음
- `onTournamentComplete` 콜백으로 GA-ML 쪽 이벤트/모달/CTA 연동 가능

## Project Structure

```text
src/
  app/
  components/
  config/
  engine/
  styles/
  types/
tests/
```

Key engine areas:

- `src/engine/core`: cards, deck, RNG, seating helpers
- `src/engine/evaluators`: 7-card hand evaluation and comparison
- `src/engine/rules`: legal actions, blinds, betting round updates, showdown helpers
- `src/engine/pots`: main/side pot construction and distribution
- `src/engine/tournament`: tournament state creation and phase advancement
- `src/engine/ai`: context building, classifiers, scoring, bet sizing, action selection

## Rules Implemented

- 52-card deck with hole cards plus flop, turn, and river
- Minimum raise logic
- Short all-in non-reopen handling
- Main pot and side pot generation
- Split pot handling with odd-chip assignment
- Dealer button movement
- Per-player antes
- Heads-up blind and action order rules
- Elimination and winner detection

## AI Approach

Bots are local, rule-based, and profile-driven. Decisions use:

- starting hand classification
- made hand and draw classification
- board texture
- stack depth
- tournament pressure tier
- legal action filtering
- weighted action scoring
- bounded seeded randomness

The AI is intentionally imperfect and profile-specific rather than solver-like.

## Tests

The test suite covers:

- hand ranking and tie-breaking
- side pot and split pot distribution
- short all-in raise reopening behavior
- blind and ante posting
- heads-up positional rules
- elimination and button movement
- AI legal action compliance

Run:

```bash
npm test
```

## Notes

- Tournament randomness is seeded per run for reproducibility.
- UI assets are placeholders; the rendering layer is intentionally easy to reskin.
- v1 is frontend-only and single-table only. There is no backend, multiplayer, or real-money support.
