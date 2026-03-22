# Web Backend Bundle

이 폴더는 다른 로컬 프로젝트로 그대로 복사해서 쓸 수 있는 `독립 실행 웹 분석 번들`입니다.

## 목적

- 일봉 OHLCV CSV를 입력으로 받음
- 최적화된 파라미터를 적용함
- 웹에서 바로 쓸 수 있는 JSON payload를 생성함
- 최근 200일 차트 preview PNG도 함께 생성함

## 포함 내용

- `src/trend_analysis/`
  - 최소 분석 엔진 코드
- `best_params/optimizer_best_params_by_head.csv`
  - 현재 최적화 결과
- `samples/`
  - 샘플 payload, 차트, 요약
- `requirements.txt`
- `run_web_export.py`
- `scripts/setup_venv.command`
- `scripts/run_web_export.command`

## 처음 1회 설정

```bash
cd web_backend_bundle
./scripts/setup_venv.command
```

## 실행

```bash
cd web_backend_bundle
./scripts/run_web_export.command /path/to/your_ohlcv.csv \
  --output-dir ./out/SPY \
  --best-params-csv ./best_params/optimizer_best_params_by_head.csv
```

## 출력 파일

- `*_web_payload.json`
- `*_current_200d.png`
- `*_web_summary.md`

## 웹에서 주로 쓰는 필드

- `current_state.trend_state_label`
- `current_state.trend_state_label_ko`
- `current_state.trend_strength_score`
- `current_state.transition_risk_score`
- `current_state.confidence_score`
- `current_state.interpretation_text_ko`
- `chart_200d.candles`

## 참고 문서

- `PAYLOAD_SCHEMA.md`
- `SOURCE_MAP.md`
