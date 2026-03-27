"""Build a report-ready markdown draft from batch image validation outputs."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass(slots=True)
class ValidationReportArtifacts:
    """Generated files for a validation report draft."""

    output_dir: Path
    report_md: Path
    report_html: Path
    image_pattern_usefulness_csv: Path
    csv_pattern_usefulness_csv: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "output_dir": str(self.output_dir),
            "report_md": str(self.report_md),
            "report_html": str(self.report_html),
            "image_pattern_usefulness_csv": str(self.image_pattern_usefulness_csv),
            "csv_pattern_usefulness_csv": str(self.csv_pattern_usefulness_csv),
        }


class ValidationReportBuilder:
    """Turn validation artifacts into a report-friendly markdown draft."""

    def __init__(self, primary_horizon: int = 10, min_pattern_samples: int = 20) -> None:
        self.primary_horizon = max(int(primary_horizon), 1)
        self.min_pattern_samples = max(int(min_pattern_samples), 1)

    def build(self, validation_dir: str | Path) -> ValidationReportArtifacts:
        validation_dir = Path(validation_dir).expanduser().resolve()
        samples_csv = validation_dir / "batch_image_validation_samples.csv"
        metrics_json = validation_dir / "batch_image_validation_metrics.json"
        if not samples_csv.exists() or not metrics_json.exists():
            raise ValueError(
                "The validation directory must contain batch_image_validation_samples.csv "
                "and batch_image_validation_metrics.json."
            )

        samples_df = pd.read_csv(samples_csv)
        metrics = json.loads(metrics_json.read_text(encoding="utf-8"))
        image_usefulness_df = self._build_image_pattern_usefulness(samples_df)
        csv_usefulness_df = self._build_csv_pattern_usefulness(samples_df)

        artifacts = ValidationReportArtifacts(
            output_dir=validation_dir,
            report_md=validation_dir / "pattern_validation_report_ko.md",
            report_html=validation_dir / "pattern_validation_report_ko.html",
            image_pattern_usefulness_csv=validation_dir / f"image_pattern_usefulness_h{self.primary_horizon}.csv",
            csv_pattern_usefulness_csv=validation_dir / f"csv_pattern_usefulness_h{self.primary_horizon}.csv",
        )
        image_usefulness_df.to_csv(artifacts.image_pattern_usefulness_csv, index=False)
        csv_usefulness_df.to_csv(artifacts.csv_pattern_usefulness_csv, index=False)
        report_context = self._build_report_context(
            metrics=metrics,
            image_usefulness_df=image_usefulness_df,
            csv_usefulness_df=csv_usefulness_df,
            samples_df=samples_df,
        )
        artifacts.report_md.write_text(
            self._render_markdown_report(report_context),
            encoding="utf-8",
        )
        artifacts.report_html.write_text(self._render_html_report(report_context), encoding="utf-8")
        return artifacts

    def _build_image_pattern_usefulness(self, samples_df: pd.DataFrame) -> pd.DataFrame:
        horizon = self.primary_horizon
        rows: list[dict[str, Any]] = []
        for (chart_style, pattern_name), frame in samples_df.groupby(["chart_style", "image_primary_pattern"], dropna=True, sort=True):
            signal_mask = frame[f"image_direction_hit_{horizon}"].notna()
            forward = frame.loc[signal_mask, f"forward_return_{horizon}"]
            hits = frame.loc[signal_mask, f"image_direction_hit_{horizon}"].astype(float)
            accuracy = float(hits.mean()) if not hits.empty else None
            baseline_up = float((forward > 0.0).mean()) if not forward.empty else None
            signed_return = self._mean_numeric(frame[f"image_signed_forward_return_{horizon}"])
            baseline_signed = self._mean_numeric(forward)
            top1_match_rate = self._mean_numeric(frame["primary_pattern_match"].astype(float))
            rows.append(
                {
                    "chart_style": chart_style,
                    "pattern_name": pattern_name,
                    "sample_count": int(len(frame)),
                    "top1_match_rate": top1_match_rate,
                    f"directional_accuracy_{horizon}": accuracy,
                    f"baseline_up_rate_{horizon}": baseline_up,
                    f"accuracy_lift_vs_always_bull_{horizon}": self._subtract(accuracy, baseline_up),
                    f"mean_signed_forward_return_{horizon}": signed_return,
                    f"baseline_mean_forward_return_{horizon}": baseline_signed,
                    f"signed_return_lift_vs_always_bull_{horizon}": self._subtract(signed_return, baseline_signed),
                    "relative_value_label": self._relative_value_label(
                        sample_count=int(len(frame)),
                        accuracy_lift=self._subtract(accuracy, baseline_up),
                        signed_lift=self._subtract(signed_return, baseline_signed),
                    ),
                }
            )
        return self._finalize_usefulness_frame(pd.DataFrame(rows), group_cols=["chart_style", "pattern_name"])

    def _build_csv_pattern_usefulness(self, samples_df: pd.DataFrame) -> pd.DataFrame:
        horizon = self.primary_horizon
        csv_df = samples_df.sort_values(["ticker", "as_of_date", "chart_style"]).drop_duplicates(subset=["ticker", "as_of_date"])
        rows: list[dict[str, Any]] = []
        for pattern_name, frame in csv_df.groupby("csv_primary_pattern", dropna=True, sort=True):
            signal_mask = frame[f"csv_direction_hit_{horizon}"].notna()
            forward = frame.loc[signal_mask, f"forward_return_{horizon}"]
            hits = frame.loc[signal_mask, f"csv_direction_hit_{horizon}"].astype(float)
            accuracy = float(hits.mean()) if not hits.empty else None
            baseline_up = float((forward > 0.0).mean()) if not forward.empty else None
            signed_return = self._mean_numeric(frame[f"csv_signed_forward_return_{horizon}"])
            baseline_signed = self._mean_numeric(forward)
            rows.append(
                {
                    "chart_style": "reference_csv",
                    "pattern_name": pattern_name,
                    "sample_count": int(len(frame)),
                    f"directional_accuracy_{horizon}": accuracy,
                    f"baseline_up_rate_{horizon}": baseline_up,
                    f"accuracy_lift_vs_always_bull_{horizon}": self._subtract(accuracy, baseline_up),
                    f"mean_signed_forward_return_{horizon}": signed_return,
                    f"baseline_mean_forward_return_{horizon}": baseline_signed,
                    f"signed_return_lift_vs_always_bull_{horizon}": self._subtract(signed_return, baseline_signed),
                    "relative_value_label": self._relative_value_label(
                        sample_count=int(len(frame)),
                        accuracy_lift=self._subtract(accuracy, baseline_up),
                        signed_lift=self._subtract(signed_return, baseline_signed),
                    ),
                }
            )
        return self._finalize_usefulness_frame(pd.DataFrame(rows), group_cols=["chart_style", "pattern_name"])

    def _finalize_usefulness_frame(self, frame: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
        if frame.empty:
            return frame
        horizon = self.primary_horizon
        return frame.sort_values(
            [group_cols[0], f"signed_return_lift_vs_always_bull_{horizon}", "sample_count", group_cols[-1]],
            ascending=[True, False, False, True],
        ).reset_index(drop=True)

    def _build_report_context(
        self,
        metrics: dict[str, Any],
        image_usefulness_df: pd.DataFrame,
        csv_usefulness_df: pd.DataFrame,
        samples_df: pd.DataFrame,
    ) -> dict[str, Any]:
        horizon = self.primary_horizon
        generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        overall_horizon = metrics["horizons"][str(horizon)]
        style_sections: list[dict[str, Any]] = []
        for chart_style, payload in metrics.get("by_chart_style", {}).items():
            style_horizon = payload.get("horizons", {}).get(str(horizon), {})
            style_frame = image_usefulness_df[image_usefulness_df["chart_style"] == chart_style].copy()
            style_sections.append(
                {
                    "chart_style": chart_style,
                    "metrics": payload,
                    "horizon_metrics": style_horizon,
                    "dominant_patterns": self._build_dominant_patterns(samples_df, chart_style),
                    "confusions": self._build_confusion_summary(samples_df, chart_style),
                    "accuracy_candidates": self._select_positive_patterns(
                        style_frame,
                        metric=f"accuracy_lift_vs_always_bull_{horizon}",
                    ),
                    "payoff_candidates": self._select_positive_patterns(
                        style_frame,
                        metric=f"signed_return_lift_vs_always_bull_{horizon}",
                    ),
                }
            )

        style_metric_rows = self._build_style_metric_rows(style_sections, horizon)

        csv_accuracy_candidates = self._select_positive_patterns(
            csv_usefulness_df,
            metric=f"accuracy_lift_vs_always_bull_{horizon}",
        )
        csv_payoff_candidates = self._select_positive_patterns(
            csv_usefulness_df,
            metric=f"signed_return_lift_vs_always_bull_{horizon}",
        )

        key_interpretations = [
            "본 검증에서 가장 중요한 결론은 패턴 기반 신호가 aggregate 수준에서 always-bull baseline을 상회하지 못했다는 점이다.",
            "즉 예측력이 약하다는 사실 자체가 의미 있는 결과이며, 패턴 분석은 설명적 도구로는 유효하지만 독립 예측 엔진으로 제시하기는 어렵다.",
            "스타일별로는 라인 차트가 캔들 차트보다 패턴 identity 복원력이 높았고, 캔들 차트는 스타일 인식은 안정적이지만 패턴 분류는 더 불안정했다.",
        ]

        if not csv_payoff_candidates.empty:
            top_csv = csv_payoff_candidates.iloc[0]
            key_interpretations.append(
                f"CSV 기준 참고 신호 중에서는 {top_csv['pattern_name']} 패턴이 {horizon}봉 horizon에서 가장 큰 signed-return lift를 보였다."
            )
        if style_sections:
            best_style = max(
                style_sections,
                key=lambda item: self._sort_key(item["metrics"].get("primary_pattern_match_rate")),
            )
            key_interpretations.append(
                f"이미지 기반에서는 {best_style['chart_style']} 스타일이 가장 높은 pattern match rate를 보여 현재 파이프라인에서는 더 신뢰할 수 있는 입력 형식으로 보인다."
            )

        return {
            "generated_at": generated_at,
            "metrics": metrics,
            "horizon": horizon,
            "style_sections": style_sections,
            "csv_accuracy_candidates": csv_accuracy_candidates,
            "csv_payoff_candidates": csv_payoff_candidates,
            "overall_horizon": overall_horizon,
            "key_interpretations": key_interpretations,
            "style_metric_rows": style_metric_rows,
        }

    def _render_markdown_report(self, context: dict[str, Any]) -> str:
        metrics = context["metrics"]
        horizon = context["horizon"]
        overall_horizon = context["overall_horizon"]
        lines = [
            "# 패턴 인식 및 예측력 검증 보고서",
            "",
            "## 1. 개요",
            f"- 생성 시각: {context['generated_at']}",
            f"- 검증 데이터 경로: {metrics['source_directory']}",
            f"- 차트 스타일: {', '.join(metrics['chart_styles'])}",
            f"- 롤링 윈도우 길이: {metrics['window_bars']}봉",
            f"- 스텝 크기: {metrics['step_bars']}봉",
            f"- 패턴 의미도 평가 기준 horizon: {horizon}봉",
            f"- 패턴 해석 최소 표본 수 기준: {self.min_pattern_samples}",
            "",
            "## 2. 검증 목적",
            "이번 검증은 두 가지 질문에 답하기 위해 수행되었다.",
            "1. 차트 이미지를 입력했을 때 패턴 인식기가 원본 OHLCV 기반 분석 결과를 어느 정도 재현하는가.",
            "2. 이렇게 얻어진 패턴 신호가 이후 수익률 방향 또는 payoff 측면에서 의미 있는가.",
            "",
            "## 3. 전체 결과",
            f"- 총 샘플 수: {metrics['sample_count']}",
            f"- 차트 스타일 인식 일치율: {self._fmt(metrics.get('chart_style_match_rate'))}",
            f"- 1순위 패턴 일치율: {self._fmt(metrics.get('primary_pattern_match_rate'))}",
            f"- 상위 2개 후보 overlap 비율: {self._fmt(metrics.get('top2_overlap_rate'))}",
            f"- {horizon}봉 이미지 방향 적중률: {self._fmt(overall_horizon.get('image_directional_accuracy'))}",
            f"- {horizon}봉 이미지 정확도 lift vs always-bull: {self._fmt(overall_horizon.get('image_accuracy_lift_vs_always_bull'))}",
            f"- {horizon}봉 이미지 signed-return lift vs always-bull: {self._fmt(overall_horizon.get('image_signed_return_lift_vs_always_bull'))}",
            "",
            "핵심 해석:",
        ]
        for item in context["key_interpretations"]:
            lines.append(f"- {item}")

        lines.extend(
            [
                "",
                "## 4. 스타일별 비교",
            ]
        )
        for style_section in context["style_sections"]:
            payload = style_section["metrics"]
            horizon_payload = style_section["horizon_metrics"]
            style_label = self._style_label(style_section["chart_style"])
            lines.extend(
                [
                    f"### {style_label}",
                    f"- 샘플 수: {payload.get('sample_count')}",
                    f"- 추세 상태 일치율: {self._fmt(payload.get('trend_state_match_rate'))}",
                    f"- 1순위 패턴 일치율: {self._fmt(payload.get('primary_pattern_match_rate'))}",
                    f"- 상위 2개 후보 overlap: {self._fmt(payload.get('top2_overlap_rate'))}",
                    f"- 지배적 이미지 패턴: {payload.get('dominant_image_pattern')} ({self._fmt(payload.get('dominant_image_pattern_share'))})",
                    f"- {horizon}봉 방향 적중률: {self._fmt(horizon_payload.get('image_directional_accuracy'))}",
                    f"- {horizon}봉 정확도 lift vs always-bull: {self._fmt(horizon_payload.get('image_accuracy_lift_vs_always_bull'))}",
                    f"- {horizon}봉 signed-return lift vs always-bull: {self._fmt(horizon_payload.get('image_signed_return_lift_vs_always_bull'))}",
                    "- 주요 이미지 패턴 점유율 상위 항목은 HTML 보고서에서 막대그래프로 함께 제시하였다.",
                    "- 주요 혼동 패턴 역시 HTML 보고서에서 별도 표로 제시하였다.",
                    "",
                    "정확도 관점에서 상대적으로 의미 있는 패턴",
                ]
            )
            lines.extend(self._render_table_lines(style_section["accuracy_candidates"], markdown=True))
            lines.extend(
                [
                    "",
                    "payoff 관점에서 상대적으로 의미 있는 패턴",
                ]
            )
            lines.extend(self._render_table_lines(style_section["payoff_candidates"], markdown=True))
            lines.append("")

        lines.extend(
            [
                "## 5. 기준선 역할의 CSV 패턴 해석",
                "정확도 관점에서 상대적으로 의미 있는 패턴",
            ]
        )
        lines.extend(self._render_table_lines(context["csv_accuracy_candidates"], markdown=True))
        lines.extend(
            [
                "",
                "payoff 관점에서 상대적으로 의미 있는 패턴",
            ]
        )
        lines.extend(self._render_table_lines(context["csv_payoff_candidates"], markdown=True))
        lines.extend(
            [
                "",
                "## 6. 패턴 의미도 해석",
                "- 정확도 lift가 양수라는 것은, 해당 패턴이 출현한 샘플만 놓고 봤을 때 무조건 상승으로 가정하는 것보다 방향 판단이 더 나았다는 뜻이다.",
                "- signed-return lift가 양수라는 것은, 방향 적중률이 다소 낮더라도 손익 기여 측면에서는 baseline보다 나았다는 뜻이다.",
                "- 따라서 bearish 계열 패턴은 정확도보다 signed-return lift를 더 중요하게 해석할 필요가 있다.",
                "",
                "## 7. 한계",
                "- 이번 검증 이미지는 내부에서 렌더링한 깨끗한 차트이므로 실제 사용자가 올리는 복잡한 스크린샷보다 쉬운 조건이다.",
                "- 이미지 경로에서는 거래량이 복원되지 않으므로 거래량 기반 패턴은 본질적으로 불리하다.",
                "- 패턴 라벨은 상호 배타적이지 않으며, 일부 패턴은 시각적 identity보다 시장 구조 대리변수에 가깝게 작동할 수 있다.",
                "",
                "## 8. 결론",
                "- 이미지 해석기는 라인 차트에서 더 안정적으로 동작했다.",
                "- 캔들 차트도 기계적으로는 분석 가능하지만 현재 단계에서는 identity 복원력이 낮다.",
                "- 전체적으로 패턴 신호는 예측력 기준으로 강한 edge를 보이지 않았다.",
                "- 그러나 이 결과는 부정적이라기보다, 패턴 분석의 역할을 설명적 도구로 규정하는 근거 자료로서 충분히 가치가 있다.",
                "",
                "## 9. 산출 파일",
                f"- Markdown 보고서: `{Path('pattern_validation_report_ko.md').name}`",
                f"- HTML 보고서: `{Path('pattern_validation_report_ko.html').name}`",
                f"- 이미지 패턴 의미도 CSV: `{Path(f'image_pattern_usefulness_h{horizon}.csv').name}`",
                f"- CSV 패턴 의미도 CSV: `{Path(f'csv_pattern_usefulness_h{horizon}.csv').name}`",
                "",
            ]
        )
        return "\n".join(lines) + "\n"

    def _render_html_report(self, context: dict[str, Any]) -> str:
        metrics = context["metrics"]
        horizon = context["horizon"]
        overall_horizon = context["overall_horizon"]
        style_blocks = []
        for style_section in context["style_sections"]:
            payload = style_section["metrics"]
            horizon_payload = style_section["horizon_metrics"]
            style_label = self._style_label(style_section["chart_style"])
            style_blocks.append(
                f"""
                <section class="card">
                  <h3>{self._escape_html(style_label)}</h3>
                  <div class="metric-grid">
                    {self._metric_card('샘플 수', payload.get('sample_count'))}
                    {self._metric_card('추세 상태 일치율', self._fmt(payload.get('trend_state_match_rate')))}
                    {self._metric_card('1순위 패턴 일치율', self._fmt(payload.get('primary_pattern_match_rate')))}
                    {self._metric_card('Top-2 overlap', self._fmt(payload.get('top2_overlap_rate')))}
                    {self._metric_card(f'{horizon}봉 방향 적중률', self._fmt(horizon_payload.get('image_directional_accuracy')))}
                    {self._metric_card(f'{horizon}봉 정확도 lift', self._fmt(horizon_payload.get('image_accuracy_lift_vs_always_bull')))}
                  </div>
                  <p class="muted">지배적 이미지 패턴: {self._escape_html(str(payload.get('dominant_image_pattern')))} ({self._fmt(payload.get('dominant_image_pattern_share'))})</p>
                  <h4>주요 이미지 패턴 점유율</h4>
                  {self._render_share_bars_html(style_section["dominant_patterns"])}
                  <h4>주요 혼동 패턴</h4>
                  {self._render_confusion_table_html(style_section["confusions"])}
                  <h4>정확도 기준 상대적으로 의미 있는 패턴</h4>
                  {self._render_table_html(style_section["accuracy_candidates"])}
                  <h4>Payoff 기준 상대적으로 의미 있는 패턴</h4>
                  {self._render_table_html(style_section["payoff_candidates"])}
                </section>
                """
            )

        return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>패턴 인식 및 예측력 검증 보고서</title>
  <style>
    :root {{
      --bg: #f4f1ea;
      --paper: #fffdf8;
      --ink: #1f2933;
      --muted: #52606d;
      --line: #d9d3c7;
      --accent: #9a3412;
      --accent-soft: #fff1e8;
      --good: #166534;
      --bad: #991b1b;
      --shadow: 0 18px 45px rgba(31, 41, 51, 0.08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      background: linear-gradient(180deg, #efe8dc 0%, var(--bg) 100%);
      color: var(--ink);
      line-height: 1.65;
    }}
    .wrap {{
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 20px 64px;
    }}
    .hero {{
      background: var(--paper);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      padding: 36px;
      margin-bottom: 24px;
    }}
    h1, h2, h3, h4 {{
      margin: 0 0 12px;
      line-height: 1.2;
      font-weight: 700;
    }}
    h1 {{ font-size: 2.3rem; letter-spacing: -0.02em; }}
    h2 {{
      font-size: 1.35rem;
      margin-top: 28px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }}
    h3 {{ font-size: 1.15rem; margin-top: 8px; }}
    h4 {{ font-size: 1rem; margin-top: 18px; }}
    p, li {{ color: var(--ink); }}
    .muted {{ color: var(--muted); }}
    .lede {{ font-size: 1.05rem; color: var(--muted); max-width: 74ch; }}
    .meta {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 20px;
    }}
    .meta-item {{
      background: #faf6ef;
      border: 1px solid var(--line);
      padding: 12px 14px;
    }}
    .meta-label {{
      display: block;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 4px;
    }}
    .section {{
      background: var(--paper);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      padding: 28px;
      margin-bottom: 20px;
    }}
    .metric-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 18px 0;
    }}
    .metric {{
      background: #faf7f1;
      border: 1px solid var(--line);
      padding: 14px;
    }}
    .metric-label {{
      display: block;
      font-size: 0.82rem;
      color: var(--muted);
      margin-bottom: 6px;
    }}
    .metric-value {{
      font-size: 1.25rem;
      font-weight: 700;
    }}
    .card {{
      background: #fcfaf5;
      border: 1px solid var(--line);
      padding: 20px;
      margin: 16px 0;
    }}
    .viz-svg {{
      width: 100%;
      height: auto;
      border: 1px solid var(--line);
      background: #fffdf8;
      margin: 8px 0 12px;
    }}
    .share-bars {{
      display: grid;
      gap: 8px;
      margin: 12px 0 18px;
    }}
    .share-row {{
      display: grid;
      grid-template-columns: minmax(180px, 220px) 1fr 72px;
      gap: 10px;
      align-items: center;
    }}
    .share-label {{
      font-size: 0.93rem;
      color: var(--ink);
    }}
    .share-track {{
      position: relative;
      height: 14px;
      background: #efe8dc;
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid #e0d6c6;
    }}
    .share-fill {{
      position: absolute;
      inset: 0 auto 0 0;
      background: linear-gradient(90deg, #9a3412 0%, #ea580c 100%);
      border-radius: 999px;
    }}
    .share-value {{
      font-variant-numeric: tabular-nums;
      color: var(--muted);
      font-size: 0.9rem;
      text-align: right;
    }}
    ul, ol {{ padding-left: 20px; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px;
      font-size: 0.95rem;
      background: white;
    }}
    th, td {{
      border: 1px solid var(--line);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }}
    th {{
      background: #f7efe3;
      font-weight: 700;
    }}
    .empty {{
      background: var(--accent-soft);
      border-left: 4px solid var(--accent);
      padding: 12px 14px;
      color: var(--muted);
      margin: 12px 0 18px;
    }}
    .footer {{
      color: var(--muted);
      font-size: 0.92rem;
      margin-top: 24px;
    }}
    @media (max-width: 720px) {{
      .wrap {{ padding: 20px 12px 36px; }}
      .hero, .section {{ padding: 20px; }}
      h1 {{ font-size: 1.8rem; }}
      table {{ font-size: 0.88rem; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>패턴 인식 및 예측력 검증 보고서</h1>
      <p class="lede">본 문서는 롤링 윈도우 기반 이미지 패턴 인식 검증과 이후 방향성 평가 결과를 정리한 보고서 초안이다. 목적은 “예측력이 높은지”를 주장하는 것이 아니라, 어떤 입력 형식이 더 안정적으로 해석되는지와 어떤 패턴이 상대적으로 더 설명적 의미를 가지는지를 데이터로 정리하는 데 있다.</p>
      <div class="meta">
        <div class="meta-item"><span class="meta-label">생성 시각</span>{self._escape_html(context['generated_at'])}</div>
        <div class="meta-item"><span class="meta-label">검증 경로</span>{self._escape_html(str(metrics['source_directory']))}</div>
        <div class="meta-item"><span class="meta-label">차트 스타일</span>{self._escape_html(', '.join(metrics['chart_styles']))}</div>
        <div class="meta-item"><span class="meta-label">평가 Horizon</span>{horizon} bars</div>
      </div>
    </section>

    <section class="section">
      <h2>핵심 결과</h2>
      <div class="metric-grid">
        {self._metric_card('총 샘플 수', metrics['sample_count'])}
        {self._metric_card('차트 스타일 일치율', self._fmt(metrics.get('chart_style_match_rate')))}
        {self._metric_card('1순위 패턴 일치율', self._fmt(metrics.get('primary_pattern_match_rate')))}
        {self._metric_card('Top-2 overlap', self._fmt(metrics.get('top2_overlap_rate')))}
        {self._metric_card(f'{horizon}봉 방향 적중률', self._fmt(overall_horizon.get('image_directional_accuracy')))}
        {self._metric_card(f'{horizon}봉 정확도 lift', self._fmt(overall_horizon.get('image_accuracy_lift_vs_always_bull')))}
        {self._metric_card(f'{horizon}봉 signed-return lift', self._fmt(overall_horizon.get('image_signed_return_lift_vs_always_bull')))}
      </div>
      <ul>
        {''.join(f'<li>{self._escape_html(item)}</li>' for item in context['key_interpretations'])}
      </ul>
    </section>

    <section class="section">
      <h2>시각 요약</h2>
      <h3>스타일별 핵심 지표 비교</h3>
      {self._render_style_metric_svg(context["style_metric_rows"])}
      <p class="muted">라인 차트와 캔들 차트의 상대적 차이를 빠르게 보기 위한 요약 시각화다. 값이 높을수록 원본 분석과 더 잘 맞거나, 동일 subset에서 더 나은 방향성을 보였음을 뜻한다.</p>
    </section>

    <section class="section">
      <h2>스타일별 비교</h2>
      {''.join(style_blocks)}
    </section>

    <section class="section">
      <h2>기준선 역할의 CSV 패턴</h2>
      <h3>정확도 기준 상대적으로 의미 있는 패턴</h3>
      {self._render_table_html(context['csv_accuracy_candidates'])}
      <h3>Payoff 기준 상대적으로 의미 있는 패턴</h3>
      {self._render_table_html(context['csv_payoff_candidates'])}
    </section>

    <section class="section">
      <h2>해석 및 한계</h2>
      <ul>
        <li>이번 검증에서 가장 중요한 사실은, 이미지 기반이든 CSV 기준이든 aggregate 수준에서 always-bull baseline을 일관되게 상회하지 못했다는 점이다.</li>
        <li>따라서 패턴 분석은 설명적 도구로는 유효하지만, 단독 예측 엔진으로 해석해서는 안 된다.</li>
        <li>이번 검증 이미지는 내부 렌더링 이미지이므로 실제 스크린샷보다 쉬운 조건이다.</li>
        <li>이미지 경로는 거래량을 복원하지 않기 때문에 거래량 기반 패턴은 구조적으로 불리하다.</li>
      </ul>
      <p class="footer">산출 파일: {self._escape_html(Path('pattern_validation_report_ko.md').name)}, {self._escape_html(Path('pattern_validation_report_ko.html').name)}, {self._escape_html(Path(f'image_pattern_usefulness_h{horizon}.csv').name)}, {self._escape_html(Path(f'csv_pattern_usefulness_h{horizon}.csv').name)}</p>
    </section>
  </div>
</body>
</html>
"""

    def _render_table_html(self, frame: pd.DataFrame) -> str:
        if frame.empty:
            return '<div class="empty">현재 표본 수 및 lift 조건을 만족한 패턴이 없다.</div>'
        headers = [
            ("pattern_name", "Pattern"),
            ("chart_style", "Style"),
            ("sample_count", "Samples"),
            ("top1_match_rate", "Top1 Match"),
            (f"directional_accuracy_{self.primary_horizon}", "Acc"),
            (f"accuracy_lift_vs_always_bull_{self.primary_horizon}", "Acc Lift"),
            (f"signed_return_lift_vs_always_bull_{self.primary_horizon}", "Signed Lift"),
        ]
        head = "".join(f"<th>{self._escape_html(label)}</th>" for _, label in headers)
        rows = []
        for _, row in frame.iterrows():
            cells = []
            for key, _label in headers:
                value = row.get(key)
                if key == "sample_count" and value is not None and not pd.isna(value):
                    cells.append(f"<td>{int(value)}</td>")
                else:
                    cells.append(f"<td>{self._escape_html(self._fmt(value) if key != 'pattern_name' and key != 'chart_style' else str(value))}</td>")
            rows.append("<tr>" + "".join(cells) + "</tr>")
        return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table>"
        for chart_style in sorted(image_usefulness_df["chart_style"].dropna().unique()):
            style_frame = image_usefulness_df[image_usefulness_df["chart_style"] == chart_style].copy()
            lines.append(f"### Image-Derived Patterns: {chart_style}")
            lines.append("")
            lines.append("Accuracy-oriented candidates")
            lines.extend(self._render_table_lines(self._select_positive_patterns(style_frame, metric=f"accuracy_lift_vs_always_bull_{horizon}")))
            lines.append("")
            lines.append("Payoff-oriented candidates")
            lines.extend(self._render_table_lines(self._select_positive_patterns(style_frame, metric=f"signed_return_lift_vs_always_bull_{horizon}")))
            lines.append("")

        lines.extend(
            [
                "### Reference CSV Patterns",
                "",
                "Accuracy-oriented candidates",
            ]
        )
        lines.extend(self._render_table_lines(self._select_positive_patterns(csv_usefulness_df, metric=f"accuracy_lift_vs_always_bull_{horizon}")))
        lines.extend(
            [
                "",
                "Payoff-oriented candidates",
            ]
        )
        lines.extend(self._render_table_lines(self._select_positive_patterns(csv_usefulness_df, metric=f"signed_return_lift_vs_always_bull_{horizon}")))
        lines.extend(
            [
                "",
                "## Interpretation",
                "- Line-chart parsing is meaningfully better than candlestick parsing in terms of pattern identity recovery.",
                "- Candlestick parsing now works mechanically, but its pattern identity is still unstable; many patterns collapse into a smaller set of bullish reversal or continuation labels.",
                "- The absence of strong aggregate predictive power is still useful evidence. It supports the report claim that pattern interpretation has descriptive value but should not be presented as a standalone forecasting engine.",
                "",
                "## Limitations",
                "- Validation images are internally rendered and cleaner than real uploaded screenshots.",
                "- Volume information is not reconstructed from the image path, so volume-based patterns are intrinsically harder to validate from image-only analysis.",
                "- Pattern labels are heuristic and overlapping; some patterns may act more like regime proxies than precise visual identities.",
                "",
                "## Output Files",
                f"- Report draft: `{Path('pattern_validation_report_draft.md').name}`",
                f"- Image pattern usefulness CSV: `{Path(f'image_pattern_usefulness_h{horizon}.csv').name}`",
                f"- CSV pattern usefulness CSV: `{Path(f'csv_pattern_usefulness_h{horizon}.csv').name}`",
                "",
            ]
        )
        return "\n".join(lines) + "\n"

    def _select_positive_patterns(self, frame: pd.DataFrame, metric: str) -> pd.DataFrame:
        if frame.empty:
            return frame
        filtered = frame[frame["sample_count"] >= self.min_pattern_samples].copy()
        if filtered.empty:
            return filtered
        filtered = filtered[pd.to_numeric(filtered[metric], errors="coerce") > 0.0].copy()
        if filtered.empty:
            return filtered
        return filtered.sort_values([metric, "sample_count"], ascending=[False, False]).head(8)

    def _render_table_lines(self, frame: pd.DataFrame, markdown: bool = True) -> list[str]:
        horizon = self.primary_horizon
        if frame.empty:
            return ["- 현재 표본 수 및 lift 조건을 만족한 패턴이 없다."]
        lines = [
            "| Pattern | Style | Samples | Top1 Match | Acc | Acc Lift | Signed Lift |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
        ]
        for _, row in frame.iterrows():
            lines.append(
                "| "
                + " | ".join(
                    [
                        str(row.get("pattern_name")),
                        str(row.get("chart_style")),
                        str(int(row.get("sample_count", 0))),
                        self._fmt(row.get("top1_match_rate")),
                        self._fmt(row.get(f"directional_accuracy_{horizon}")),
                        self._fmt(row.get(f"accuracy_lift_vs_always_bull_{horizon}")),
                        self._fmt(row.get(f"signed_return_lift_vs_always_bull_{horizon}")),
                    ]
                )
                + " |"
            )
        return lines

    @staticmethod
    def _style_label(chart_style: str) -> str:
        labels = {
            "line": "라인 차트",
            "candlestick": "캔들 차트",
            "reference_csv": "CSV 기준",
        }
        return labels.get(chart_style, chart_style)

    @staticmethod
    def _mean_numeric(series: pd.Series) -> float | None:
        cleaned = pd.to_numeric(series, errors="coerce").dropna()
        if cleaned.empty:
            return None
        return float(cleaned.mean())

    def _relative_value_label(
        self,
        sample_count: int,
        accuracy_lift: float | None,
        signed_lift: float | None,
    ) -> str:
        if sample_count < self.min_pattern_samples:
            return "insufficient_samples"
        if (accuracy_lift or 0.0) > 0.0 and (signed_lift or 0.0) > 0.0:
            return "positive_accuracy_and_payoff"
        if (signed_lift or 0.0) > 0.0:
            return "positive_payoff_only"
        if (accuracy_lift or 0.0) > 0.0:
            return "positive_accuracy_only"
        return "no_relative_edge"

    @staticmethod
    def _subtract(left: float | None, right: float | None) -> float | None:
        if left is None or right is None:
            return None
        return float(left - right)

    @staticmethod
    def _fmt(value: Any) -> str:
        if value is None or pd.isna(value):
            return "n/a"
        return f"{float(value):.4f}"

    @staticmethod
    def _sort_key(value: Any) -> float:
        if value is None or pd.isna(value):
            return float("-inf")
        return float(value)

    @staticmethod
    def _escape_html(value: str) -> str:
        return (
            str(value)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )

    def _metric_card(self, label: str, value: Any) -> str:
        return (
            '<div class="metric">'
            f'<span class="metric-label">{self._escape_html(label)}</span>'
            f'<span class="metric-value">{self._escape_html(str(value))}</span>'
            "</div>"
        )

    def _build_style_metric_rows(self, style_sections: list[dict[str, Any]], horizon: int) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        metric_specs = [
            ("추세 상태 일치율", "trend_state_match_rate", "metrics"),
            ("1순위 패턴 일치율", "primary_pattern_match_rate", "metrics"),
            ("Top-2 overlap", "top2_overlap_rate", "metrics"),
            (f"{horizon}봉 방향 적중률", "image_directional_accuracy", "horizon_metrics"),
        ]
        for label, key, source in metric_specs:
            row = {"label": label}
            for section in style_sections:
                style = section["chart_style"]
                container = section[source]
                row[style] = container.get(key)
            rows.append(row)
        return rows

    def _build_dominant_patterns(self, samples_df: pd.DataFrame, chart_style: str, top_n: int = 8) -> pd.DataFrame:
        style_df = samples_df[samples_df["chart_style"] == chart_style]
        if style_df.empty:
            return pd.DataFrame(columns=["pattern_name", "sample_count", "sample_share"])
        counts = (
            style_df["image_primary_pattern"]
            .dropna()
            .value_counts()
            .rename_axis("pattern_name")
            .reset_index(name="sample_count")
        )
        counts["sample_share"] = counts["sample_count"] / max(len(style_df), 1)
        return counts.head(top_n)

    def _build_confusion_summary(self, samples_df: pd.DataFrame, chart_style: str, top_n: int = 10) -> pd.DataFrame:
        style_df = samples_df[samples_df["chart_style"] == chart_style].copy()
        style_df = style_df[style_df["csv_primary_pattern"] != style_df["image_primary_pattern"]]
        if style_df.empty:
            return pd.DataFrame(columns=["csv_primary_pattern", "image_primary_pattern", "count", "share"])
        grouped = (
            style_df.groupby(["csv_primary_pattern", "image_primary_pattern"], dropna=False)
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
            .head(top_n)
            .reset_index(drop=True)
        )
        grouped["share"] = grouped["count"] / max(len(style_df), 1)
        return grouped

    def _render_style_metric_svg(self, metric_rows: list[dict[str, Any]]) -> str:
        if not metric_rows:
            return '<div class="empty">시각화할 스타일 비교 데이터가 없다.</div>'
        styles = ["line", "candlestick"]
        style_colors = {
            "line": "#9a3412",
            "candlestick": "#0f766e",
        }
        width = 900
        height = 360
        margin_left = 76
        margin_right = 24
        margin_top = 24
        margin_bottom = 78
        chart_width = width - margin_left - margin_right
        chart_height = height - margin_top - margin_bottom
        group_count = len(metric_rows)
        group_width = chart_width / max(group_count, 1)
        bar_width = min(42.0, (group_width - 28.0) / max(len(styles), 1))
        svg_parts = [
            f'<svg viewBox="0 0 {width} {height}" class="viz-svg" role="img" aria-label="스타일별 핵심 지표 비교 차트">',
            f'<rect x="0" y="0" width="{width}" height="{height}" fill="#fffdf8" />',
        ]
        for grid in range(6):
            value = grid / 5
            y = margin_top + chart_height - (chart_height * value)
            svg_parts.append(f'<line x1="{margin_left}" y1="{y:.1f}" x2="{width - margin_right}" y2="{y:.1f}" stroke="#d9d3c7" stroke-width="1" />')
            svg_parts.append(
                f'<text x="{margin_left - 10}" y="{y + 4:.1f}" text-anchor="end" font-size="11" fill="#52606d">{value:.1f}</text>'
            )
        for index, row in enumerate(metric_rows):
            group_x = margin_left + (group_width * index)
            label_x = group_x + (group_width / 2)
            for style_index, style in enumerate(styles):
                value = row.get(style)
                if value is None or pd.isna(value):
                    continue
                bar_height = chart_height * max(0.0, min(1.0, float(value)))
                x = group_x + 14 + (style_index * (bar_width + 10))
                y = margin_top + chart_height - bar_height
                svg_parts.append(
                    f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_width:.1f}" height="{bar_height:.1f}" fill="{style_colors[style]}" rx="4" />'
                )
                svg_parts.append(
                    f'<text x="{x + (bar_width / 2):.1f}" y="{max(y - 6, 12):.1f}" text-anchor="middle" font-size="10" fill="#1f2933">{float(value):.2f}</text>'
                )
            svg_parts.append(
                f'<text x="{label_x:.1f}" y="{height - 34}" text-anchor="middle" font-size="11" fill="#1f2933">{self._escape_html(row["label"])}</text>'
            )
        legend_y = height - 14
        legend_x = margin_left
        for style in styles:
            svg_parts.append(f'<rect x="{legend_x}" y="{legend_y - 10}" width="12" height="12" fill="{style_colors[style]}" rx="2" />')
            svg_parts.append(
                f'<text x="{legend_x + 18}" y="{legend_y}" font-size="11" fill="#52606d">{self._escape_html(self._style_label(style))}</text>'
            )
            legend_x += 120
        svg_parts.append("</svg>")
        return "".join(svg_parts)

    def _render_share_bars_html(self, frame: pd.DataFrame) -> str:
        if frame.empty:
            return '<div class="empty">점유율 차트를 만들 패턴 데이터가 없다.</div>'
        rows: list[str] = []
        for _, row in frame.iterrows():
            share = float(row.get("sample_share", 0.0) or 0.0)
            rows.append(
                '<div class="share-row">'
                f'<div class="share-label">{self._escape_html(str(row.get("pattern_name")))}</div>'
                '<div class="share-track">'
                f'<div class="share-fill" style="width:{max(share * 100.0, 0.0):.2f}%"></div>'
                "</div>"
                f'<div class="share-value">{self._fmt(share)}</div>'
                "</div>"
            )
        return '<div class="share-bars">' + "".join(rows) + "</div>"

    def _render_confusion_table_html(self, frame: pd.DataFrame) -> str:
        if frame.empty:
            return '<div class="empty">요약할 주요 혼동 패턴이 없다.</div>'
        max_count = max(int(frame["count"].max()), 1)
        rows: list[str] = []
        for _, row in frame.iterrows():
            intensity = 0.15 + (0.55 * (float(row["count"]) / max_count))
            rows.append(
                "<tr>"
                f"<td>{self._escape_html(str(row.get('csv_primary_pattern')))}</td>"
                f"<td>{self._escape_html(str(row.get('image_primary_pattern')))}</td>"
                f'<td style="background: rgba(154, 52, 18, {intensity:.3f}); color: #1f2933;">{int(row.get("count", 0))}</td>'
                f"<td>{self._fmt(row.get('share'))}</td>"
                "</tr>"
            )
        return (
            "<table><thead><tr><th>CSV 원본 패턴</th><th>이미지 해석 패턴</th><th>Count</th><th>Share</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table>"
        )
