# Payload Schema

샘플 파일: `samples/SPY_web_payload.json`

## 최상위 구조

```json
{
  "meta": {},
  "current_state": {},
  "chart_200d": {
    "candles": []
  },
  "raw_feature_snapshot": {},
  "indicator_snapshot": {},
  "component_scores": {}
}
```

## meta

- `ticker`
- `as_of_date`
- `config_source`
- `best_direction_family`
- `window_bars`
- `window_start`
- `window_end`

## current_state

웹 화면 메인 카드에서 가장 중요한 블록입니다.

- `trend_state_label`
  - `bullish | sideways | bearish`
- `trend_state_label_ko`
  - `상승 우위 | 횡보 | 하락 우위`
- `regime_label_internal`
  - 내부 5단계 레이블
- `trend_strength_score`
  - 추세 강도 `0 ~ 100`
- `trend_conviction_score`
  - 추세 확신도 `0 ~ 100`
- `transition_risk_score`
  - 전환 위험 `0 ~ 100`
- `transition_risk_label`
  - `low | moderate | high`
- `confidence_score`
  - 현재 판독 신뢰도 `0 ~ 100`
- `direction_score`
- `momentum_score`
- `volatility_regime_score`
- `volume_confirmation_score`
- `tags`
- `summary_text`
- `interpretation_text_ko`

## chart_200d.candles[]

최근 200일 표시용 데이터입니다.

각 row:

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `trend_state_label`
- `regime_label`
- `trend_strength_score`
- `transition_risk_score`
- `confidence_score`
- `composite_trend_score`

## 권장 웹 표시

- 현재 추세: `trend_state_label_ko`
- 추세 강도: `trend_strength_score`
- 전환 위험: `transition_risk_score`
- 신뢰도: `confidence_score`
- 해석 문장: `interpretation_text_ko`
- 200일 차트: `chart_200d.candles`
