"""Rendering helpers for chart interpretation outputs."""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MPLCONFIGDIR = Path(os.environ.get("MPLCONFIGDIR", Path.cwd() / ".matplotlib-cache"))
MPLCONFIGDIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(MPLCONFIGDIR))

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import pandas as pd

from ..utils import clamp
from .config import ChartInterpretationConfig
from .localization import build_report_locales
from .models import ChartInterpretationResult, PatternSignal


THEME = {
    "bull": "#0f8b6d",
    "bear": "#b45309",
    "bull_soft": "#8fd3c4",
    "bear_soft": "#f5c77f",
    "neutral": "#475569",
    "ink": "#111827",
    "muted": "#64748b",
    "grid": "#dbe4ee",
    "zone_fill": "#d9f0ea",
    "zone_fill_bear": "#f9e4c4",
    "projection": "#94a3b8",
    "target_1": "#0f766e",
    "target_2": "#2563eb",
    "invalidation": "#c2410c",
}


@dataclass(slots=True)
class InterpretationArtifacts:
    """Saved output files for one interpretation run."""

    output_dir: Path
    analysis_json: Path
    chart_png: Path
    report_html: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "output_dir": str(self.output_dir),
            "analysis_json": str(self.analysis_json),
            "chart_png": str(self.chart_png),
            "report_html": str(self.report_html),
        }


class ChartInterpretationRenderer:
    """Render chart interpretation outputs as static image and HTML."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def export(
        self,
        frame: pd.DataFrame,
        analysis: ChartInterpretationResult,
        output_dir: str | Path,
        title: str,
    ) -> InterpretationArtifacts:
        output_dir = Path(output_dir).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        slug = title.replace(" ", "_").replace("/", "_")
        artifacts = InterpretationArtifacts(
            output_dir=output_dir,
            analysis_json=output_dir / f"{slug}_analysis.json",
            chart_png=output_dir / f"{slug}_chart.png",
            report_html=output_dir / f"{slug}_report.html",
        )
        payload = analysis.to_dict()
        payload["locales"] = build_report_locales(payload)
        artifacts.analysis_json.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        self.render_chart_png(frame, analysis, artifacts.chart_png, title)
        artifacts.report_html.write_text(self.render_html_report(title, payload, artifacts.chart_png), encoding="utf-8")
        return artifacts

    def render_chart_png(
        self,
        frame: pd.DataFrame,
        analysis: ChartInterpretationResult,
        output_path: str | Path,
        title: str,
    ) -> None:
        price_frame, start_index, end_index = self._display_window(frame, analysis)
        projection = analysis.projection.to_dict()
        future_points = projection["base_path"]
        figure = plt.figure(figsize=(self.config.render.figure_width, self.config.render.figure_height))
        if self.config.render.show_macd:
            grid = figure.add_gridspec(3, 1, height_ratios=[5.8, 1.35, 1.2], hspace=0.02)
            ax_price = figure.add_subplot(grid[0, 0])
            ax_macd = figure.add_subplot(grid[1, 0], sharex=ax_price)
            ax_volume = figure.add_subplot(grid[2, 0], sharex=ax_price)
        else:
            grid = figure.add_gridspec(2, 1, height_ratios=[5.5, 1.2], hspace=0.02)
            ax_price = figure.add_subplot(grid[0, 0])
            ax_macd = None
            ax_volume = figure.add_subplot(grid[1, 0], sharex=ax_price)

        figure.patch.set_facecolor("#f7f4ed")
        ax_price.set_facecolor("#fbfaf7")
        if ax_macd is not None:
            ax_macd.set_facecolor("#fbfaf7")
        ax_volume.set_facecolor("#fbfaf7")

        self._draw_candles(ax_price, price_frame)
        if self.config.render.show_ema:
            self._draw_emas(ax_price, price_frame)
        if self._should_show_ichimoku(analysis):
            self._draw_ichimoku(ax_price, price_frame)
        self._draw_projection_region(ax_price, price_frame, future_points)
        self._draw_relevant_zones(ax_price, frame, analysis, price_frame)
        self._draw_structure_levels(ax_price, frame, analysis, start_index, end_index)
        if self.config.render.show_trendlines:
            self._draw_trendlines(ax_price, frame, analysis, start_index, end_index)
        if self.config.render.show_pattern_lines:
            self._draw_pattern_lines(ax_price, frame, analysis, start_index, end_index)
        if self.config.render.show_candlestick_signals:
            self._draw_candlestick_signals(ax_price, frame, analysis, start_index)
        self._draw_targets(ax_price, price_frame.index[-1], analysis)
        if self.config.render.show_projection:
            self._draw_projection(ax_price, projection)

        ax_price.set_title(f"{title} | Daily Technical Map", loc="left", fontsize=15, color=THEME["ink"], pad=16)
        ax_price.text(
            0.995,
            0.985,
            "Scenario paths, not forecasts",
            transform=ax_price.transAxes,
            ha="right",
            va="top",
            fontsize=9,
            color=THEME["muted"],
        )
        ax_price.set_ylabel("Price", color=THEME["muted"])
        ax_price.grid(True, alpha=0.18, linewidth=0.7, color=THEME["grid"])
        ax_price.spines["top"].set_visible(False)
        ax_price.spines["right"].set_visible(False)
        ax_price.spines["left"].set_color("#d0d8e3")
        ax_price.spines["bottom"].set_color("#d0d8e3")
        ax_price.tick_params(colors=THEME["muted"])
        ax_price.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
        plt.setp(ax_price.get_xticklabels(), visible=False)
        handles, labels = ax_price.get_legend_handles_labels()
        if handles:
            ax_price.legend(
                handles,
                labels,
                loc="upper left",
                bbox_to_anchor=(0.0, 1.0),
                fontsize=8,
                frameon=False,
                ncol=min(4, len(handles)),
                labelcolor=THEME["muted"],
            )

        if ax_macd is not None:
            self._draw_macd(ax_macd, price_frame)
            ax_macd.grid(True, alpha=0.12, linewidth=0.7, color=THEME["grid"])
            ax_macd.spines["top"].set_visible(False)
            ax_macd.spines["right"].set_visible(False)
            ax_macd.spines["left"].set_color("#d0d8e3")
            ax_macd.spines["bottom"].set_color("#d0d8e3")
            ax_macd.tick_params(colors=THEME["muted"], labelsize=8)
            ax_macd.axhline(0.0, color="#94a3b8", linewidth=0.8, alpha=0.5)
            ax_macd.set_ylabel("MACD", color=THEME["muted"])
            plt.setp(ax_macd.get_xticklabels(), visible=False)

        volume_colors = [THEME["bull"] if close >= open_ else THEME["bear"] for open_, close in zip(price_frame["open"], price_frame["close"])]
        ax_volume.bar(price_frame.index, price_frame["volume"], color=volume_colors, width=0.9, alpha=0.55)
        ax_volume.set_ylabel("Volume", color=THEME["muted"])
        ax_volume.grid(True, alpha=0.10, color=THEME["grid"])
        ax_volume.spines["top"].set_visible(False)
        ax_volume.spines["right"].set_visible(False)
        ax_volume.spines["left"].set_color("#d0d8e3")
        ax_volume.spines["bottom"].set_color("#d0d8e3")
        ax_volume.tick_params(colors=THEME["muted"])
        ax_volume.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
        for label in ax_volume.get_xticklabels():
            label.set_rotation(20)
            label.set_horizontalalignment("right")

        future_dates = [pd.Timestamp(item["timestamp"]) for item in future_points]
        if future_dates:
            ax_price.set_xlim(price_frame.index[0], future_dates[-1] + pd.Timedelta(days=2))
        else:
            ax_price.set_xlim(price_frame.index[0], price_frame.index[-1] + pd.Timedelta(days=2))
        ax_price.margins(y=0.18)
        figure.subplots_adjust(left=0.06, right=0.97, top=0.93, bottom=0.11)
        figure.savefig(output_path, dpi=self.config.render.dpi, facecolor=figure.get_facecolor())
        plt.close(figure)

    def render_html_report(self, title: str, payload: dict[str, Any], chart_path: Path) -> str:
        image_b64 = base64.b64encode(chart_path.read_bytes()).decode("ascii")
        json_block = ""
        if self.config.render.show_debug_json:
            json_block = """
      <details class="debug-card">
        <summary id="debugSummary">Developer JSON</summary>
        <pre id="debugJson"></pre>
      </details>
"""
        payload_json = json.dumps(payload, ensure_ascii=False)

        return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} Technical Report</title>
  <style>
    :root {{
      --paper: #f7f4ed;
      --panel: #fcfbf8;
      --ink: #18212b;
      --muted: #5f6b7a;
      --line: #d9dedf;
      --accent: #0f8b6d;
      --accent-soft: #dff1ec;
      --bear: #b45309;
      --bear-soft: #f8ead7;
      --shadow: 0 18px 42px rgba(24, 33, 43, 0.08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background:
        radial-gradient(circle at top right, rgba(15, 139, 109, 0.10), transparent 28%),
        radial-gradient(circle at left 20%, rgba(180, 83, 9, 0.07), transparent 22%),
        var(--paper);
      color: var(--ink);
      font-family: "Avenir Next", "Helvetica Neue", sans-serif;
    }}
    .report {{
      min-height: 100vh;
      display: grid;
      grid-template-columns: 360px 1fr;
    }}
    .side {{
      padding: 28px 24px;
      border-right: 1px solid var(--line);
      background: rgba(252, 251, 248, 0.92);
      backdrop-filter: blur(8px);
    }}
    .main {{
      padding: 28px;
      display: grid;
      gap: 18px;
      align-content: start;
    }}
    h1, h2, h3 {{
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", serif;
      font-weight: 600;
      letter-spacing: -0.02em;
    }}
    h1 {{ font-size: 32px; margin-bottom: 6px; }}
    h2 {{ font-size: 20px; margin-bottom: 10px; }}
    .kicker {{
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }}
    .lang-switch {{
      display: inline-flex;
      gap: 8px;
      margin-bottom: 16px;
    }}
    .lang-switch button {{
      border: 1px solid var(--line);
      background: #f4f1eb;
      color: var(--ink);
      border-radius: 999px;
      padding: 7px 12px;
      cursor: pointer;
      font-size: 12px;
    }}
    .lang-switch button.active {{
      background: var(--accent-soft);
      color: #0d6d55;
      border-color: rgba(15, 139, 109, 0.30);
    }}
    .summary {{
      font-size: 16px;
      line-height: 1.65;
      color: #243140;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid rgba(217, 222, 223, 0.95);
      border-radius: 22px;
      padding: 18px;
      box-shadow: var(--shadow);
    }}
    .metric-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 16px;
    }}
    .metric {{
      border-radius: 16px;
      background: #f5f1ea;
      border: 1px solid var(--line);
      padding: 12px;
    }}
    .label {{
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }}
    .value {{
      font-size: 15px;
      line-height: 1.5;
    }}
    .hero {{
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }}
    .hero img {{
      width: 100%;
      display: block;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: white;
    }}
    .grid-two {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }}
    .pill {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      margin: 6px 8px 0 0;
      background: #eef2f7;
      color: #314156;
    }}
    .pill.bull {{ background: var(--accent-soft); color: #0d6d55; }}
    .pill.bear {{ background: var(--bear-soft); color: #95520d; }}
    ul {{
      margin: 10px 0 0;
      padding-left: 18px;
      color: #314156;
      line-height: 1.6;
    }}
    .subtle {{
      color: var(--muted);
      line-height: 1.6;
    }}
    .debug-card {{
      margin-top: 16px;
      border: 1px dashed var(--line);
      border-radius: 16px;
      padding: 14px;
      background: #faf7f1;
    }}
    pre {{
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      color: #394a60;
    }}
    @media (max-width: 1180px) {{
      .report {{ grid-template-columns: 1fr; }}
      .side {{ border-right: 0; border-bottom: 1px solid var(--line); }}
      .grid-two {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="report">
    <aside class="side">
      <div class="kicker" id="reportKicker"></div>
      <div class="lang-switch">
        <button type="button" id="langKo">한글</button>
        <button type="button" id="langEn">English</button>
      </div>
      <h1>{title}</h1>
      <p class="summary" id="summaryText"></p>

      <div class="metric-grid">
        <div class="metric"><div class="label" id="trendLabel"></div><div class="value" id="trendValue"></div></div>
        <div class="metric"><div class="label" id="structureLabel"></div><div class="value" id="structureValue"></div></div>
        <div class="metric"><div class="label" id="locationLabel"></div><div class="value" id="locationValue"></div></div>
        <div class="metric"><div class="label" id="convictionLabel"></div><div class="value" id="convictionValue"></div></div>
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="label" id="primaryLabel"></div>
        <div id="primaryScenarioBody"></div>
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="label" id="alternativeLabel"></div>
        <div id="alternativeScenarioBody"></div>
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="label" id="confirmationLabel"></div>
        <ul id="confirmationList"></ul>
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="label" id="riskLabel"></div>
        <ul id="riskList"></ul>
      </div>
      {json_block}
    </aside>

    <main class="main">
      <section class="card hero">
        <div>
          <div class="label" id="chartFocusLabel"></div>
          <h2 id="chartFocusTitle"></h2>
          <p class="subtle" id="chartFocusText"></p>
        </div>
        <img alt="technical analysis chart" src="data:image/png;base64,{image_b64}">
      </section>

      <section class="grid-two">
        <div class="card">
          <div class="label" id="notesLabel"></div>
          <div id="notesBody"></div>
        </div>
        <div class="card">
          <div class="label" id="levelsLabel"></div>
          <div id="levelsBody"></div>
        </div>
      </section>

      <section class="grid-two">
        <div class="card">
          <div class="label" id="patternsLabel"></div>
          <div id="patternsBody"></div>
        </div>
        <div class="card">
          <div class="label" id="eventsLabel"></div>
          <div id="eventsBody"></div>
        </div>
      </section>

      <section class="card">
        <div class="label" id="projectionLabel"></div>
        <p class="subtle" id="projectionText"></p>
        <div id="projectionPills"></div>
      </section>
    </main>
  </div>
  <script>
    const REPORT_DATA = {payload_json};
    const UI_COPY = {{
      en: {{
        reportKicker: "Technical Analysis Report",
        trend: "Trend",
        structure: "Structure",
        location: "Location",
        conviction: "Conviction",
        primary: "Primary Scenario",
        alternative: "Strongest Alternative",
        confirmation: "Confirmation Needed",
        risk: "Risk Notes",
        chartFocusLabel: "Chart Focus",
        chartFocusTitle: "Recent actionable structure",
        chartFocusText: "Historical data is still used for analysis, but the visible window is narrowed to the setup that matters now.",
        notes: "Analyst Notes",
        levels: "Key Levels",
        patterns: "Active Patterns",
        events: "Recent Events",
        projection: "Projection Framing",
        projectionText: "The projected base, bullish, and bearish paths are scenario sketches built from current structure, measured moves, and volatility. They are not deterministic forecasts.",
        invalidation: "Invalidation Level",
        invalidationHelp: "If price breaks this level, the current main scenario is weakened or invalidated.",
        target1: "1st Target Zone",
        target1Help: "The first area where price is expected to react or pause.",
        target2: "2nd Target Zone",
        target2Help: "The next extension zone if the move keeps following through.",
        noAlternative: "No clear alternative is standing out.",
        noItems: "No extra items listed.",
        noPatterns: "No active pattern is strong enough to highlight.",
        noEvents: "No recent event sequence was recorded.",
        debug: "Developer JSON",
        direction: "Direction",
        score: "Score",
        confidenceMetric: "Confidence",
        freshness: "Freshness",
        strength: "Strength",
      }},
      ko: {{
        reportKicker: "기술적 분석 리포트",
        trend: "추세",
        structure: "구조",
        location: "위치",
        conviction: "확신도",
        primary: "주 시나리오",
        alternative: "가장 강한 대안",
        confirmation: "확인 조건",
        risk: "리스크 메모",
        chartFocusLabel: "차트 포커스",
        chartFocusTitle: "최근 핵심 구조",
        chartFocusText: "분석에는 전체 이력을 쓰지만, 화면에는 지금 실제로 중요한 셋업 구간만 압축해 보여줍니다.",
        notes: "애널리스트 메모",
        levels: "핵심 레벨",
        patterns: "활성 패턴",
        events: "최근 이벤트",
        projection: "투영 해석",
        projectionText: "기본 경로와 상방·하방 경로는 현재 구조, 측정 목표, 변동성을 바탕으로 그린 시나리오 스케치입니다. 확정 예측선이 아닙니다.",
        invalidation: "무효화 기준",
        invalidationHelp: "가격이 이 레벨을 깨면 현재 주 시나리오 해석은 약해지거나 폐기됩니다.",
        target1: "1차 목표 구간",
        target1Help: "가격이 먼저 반응하거나 잠시 쉬어갈 가능성이 있는 구간입니다.",
        target2: "2차 목표 구간",
        target2Help: "추세가 더 이어질 때 보는 다음 확장 목표 구간입니다.",
        noAlternative: "뚜렷한 대안 시나리오가 아직 부각되지는 않습니다.",
        noItems: "추가로 표시할 항목이 없습니다.",
        noPatterns: "강하게 강조할 만큼 유효한 활성 패턴이 없습니다.",
        noEvents: "최근 이벤트 시퀀스가 별도로 기록되지는 않았습니다.",
        debug: "개발자 JSON",
        direction: "방향",
        score: "점수",
        confidenceMetric: "확신도",
        freshness: "신선도",
        strength: "강도",
      }},
    }};
    let currentLanguage = localStorage.getItem("chartReportLanguage") || (REPORT_DATA.locales && REPORT_DATA.locales.default) || "ko";

    function localeData() {{
      return (REPORT_DATA.locales && REPORT_DATA.locales[currentLanguage]) || REPORT_DATA;
    }}

    function priceText(value) {{
      if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
      return Number(value).toFixed(2);
    }}

    function zoneText(zone) {{
      if (!zone) return "-";
      const joiner = currentLanguage === "ko" ? " ~ " : " to ";
      return `${{priceText(zone.low)}}${{joiner}}${{priceText(zone.high)}}`;
    }}

    function listMarkup(items, emptyText) {{
      if (!items || !items.length) return `<li>${{emptyText}}</li>`;
      return items.map((item) => `<li>${{item}}</li>`).join("");
    }}

    function scenarioMarkup(title, scenario, explanation, copy) {{
      if (!scenario) {{
        return `<h2>${{copy.noAlternative}}</h2>`;
      }}
      const pillClass = scenario.direction === "상방" || scenario.direction === "bullish" ? "bull" : scenario.direction === "하방" || scenario.direction === "bearish" ? "bear" : "";
      return `
        <h2>${{scenario.name}}</h2>
        <p class="subtle">${{explanation || (scenario.explanation || []).join(" ")}}</p>
        <div class="pill ${{pillClass}}">${{scenario.direction}}</div>
        <div class="pill">${{copy.invalidation}} ${{priceText(scenario.invalidation_level)}}</div>
      `;
    }}

    function notesMarkup(notes, copy) {{
      if (!notes || !notes.length) return `<p class="subtle">${{copy.noItems}}</p>`;
      return notes.map((item) => `<p class="subtle">${{item}}</p>`).join("");
    }}

    function levelsMarkup(copy) {{
      const primary = REPORT_DATA.primary_scenario || {{}};
      return [
        {{ label: copy.invalidation, value: priceText(REPORT_DATA.invalidation_level), help: copy.invalidationHelp }},
        {{ label: copy.target1, value: zoneText(primary.target_zone_1), help: copy.target1Help }},
        {{ label: copy.target2, value: zoneText(primary.target_zone_2), help: copy.target2Help }},
      ].map((level) => `
        <div class="metric" style="margin-bottom:10px;">
          <div class="label">${{level.label}}</div>
          <div class="value">${{level.value}}</div>
          <div class="subtle">${{level.help}}</div>
        </div>
      `).join("");
    }}

    function patternMarkup(patterns, copy) {{
      if (!patterns || !patterns.length) return `<p class="subtle">${{copy.noPatterns}}</p>`;
      return patterns.slice(0, 1).map((pattern) => `
        <div class="metric" style="margin-bottom:10px;">
          <div class="label">${{pattern.pattern_name}}</div>
          <div class="value">${{pattern.direction}} | ${{copy.confidenceMetric}} ${{pattern.confidence.toFixed(2)}} | ${{copy.freshness}} ${{pattern.freshness.toFixed(2)}}</div>
          <div class="subtle">${{(pattern.explanation || []).join(" ")}}</div>
        </div>
      `).join("");
    }}

    function eventMarkup(events, copy) {{
      if (!events || !events.length) return `<p class="subtle">${{copy.noEvents}}</p>`;
      return events.slice(0, 5).map((event) => `
        <div class="metric" style="margin-bottom:10px;">
          <div class="label">${{event.event_type}}</div>
          <div class="value">${{event.details}}</div>
          <div class="subtle">${{event.timestamp}} | ${{copy.strength}} ${{event.strength.toFixed(2)}}</div>
        </div>
      `).join("");
    }}

    function applyLanguage(lang) {{
      currentLanguage = lang;
      localStorage.setItem("chartReportLanguage", lang);
      const copy = UI_COPY[lang];
      const localized = localeData();

      document.documentElement.lang = lang === "ko" ? "ko" : "en";
      document.getElementById("reportKicker").textContent = copy.reportKicker;
      document.getElementById("summaryText").textContent = localized.summary_text || "";
      document.getElementById("trendLabel").textContent = copy.trend;
      document.getElementById("structureLabel").textContent = copy.structure;
      document.getElementById("locationLabel").textContent = copy.location;
      document.getElementById("convictionLabel").textContent = copy.conviction;
      document.getElementById("trendValue").textContent = localized.trend_state || "-";
      document.getElementById("structureValue").textContent = localized.market_structure || "-";
      document.getElementById("locationValue").textContent = localized.location_state || "-";
      document.getElementById("convictionValue").textContent = `${{REPORT_DATA.confidence.toFixed(2)}} | ${{localized.confidence_label || REPORT_DATA.confidence_label || ""}}`;
      document.getElementById("primaryLabel").textContent = copy.primary;
      document.getElementById("alternativeLabel").textContent = copy.alternative;
      document.getElementById("confirmationLabel").textContent = copy.confirmation;
      document.getElementById("riskLabel").textContent = copy.risk;
      document.getElementById("chartFocusLabel").textContent = copy.chartFocusLabel;
      document.getElementById("chartFocusTitle").textContent = copy.chartFocusTitle;
      document.getElementById("chartFocusText").textContent = copy.chartFocusText;
      document.getElementById("notesLabel").textContent = copy.notes;
      document.getElementById("levelsLabel").textContent = copy.levels;
      document.getElementById("patternsLabel").textContent = copy.patterns;
      document.getElementById("eventsLabel").textContent = copy.events;
      document.getElementById("projectionLabel").textContent = copy.projection;
      document.getElementById("projectionText").textContent = copy.projectionText;

      document.getElementById("primaryScenarioBody").innerHTML = scenarioMarkup(copy.primary, localized.primary_scenario, localized.primary_scenario_explanation, copy);
      document.getElementById("alternativeScenarioBody").innerHTML = scenarioMarkup(copy.alternative, localized.strongest_alternative, localized.alternative_scenario_explanation, copy);
      document.getElementById("confirmationList").innerHTML = listMarkup(localized.confirmation_checklist || [], copy.noItems);
      document.getElementById("riskList").innerHTML = listMarkup(localized.risk_notes || [], copy.noItems);
      document.getElementById("notesBody").innerHTML = notesMarkup([localized.primary_scenario_explanation, localized.alternative_scenario_explanation].filter(Boolean), copy);
      document.getElementById("levelsBody").innerHTML = levelsMarkup(copy);
      document.getElementById("patternsBody").innerHTML = patternMarkup(localized.active_patterns || [], copy);
      document.getElementById("eventsBody").innerHTML = eventMarkup(localized.recent_events || [], copy);
      document.getElementById("projectionPills").innerHTML = `
        <div class="pill">${{copy.target1}} ${{zoneText(REPORT_DATA.projection.target_zone_1)}}</div>
        <div class="pill">${{copy.target2}} ${{zoneText(REPORT_DATA.projection.target_zone_2)}}</div>
      `;
      if (document.getElementById("debugSummary")) {{
        document.getElementById("debugSummary").textContent = copy.debug;
        document.getElementById("debugJson").textContent = JSON.stringify(REPORT_DATA, null, 2);
      }}

      document.getElementById("langKo").classList.toggle("active", lang === "ko");
      document.getElementById("langEn").classList.toggle("active", lang === "en");
    }}

    document.getElementById("langKo").addEventListener("click", () => applyLanguage("ko"));
    document.getElementById("langEn").addEventListener("click", () => applyLanguage("en"));
    applyLanguage(currentLanguage);
  </script>
</body>
</html>"""

    def _display_window(self, frame: pd.DataFrame, analysis: ChartInterpretationResult) -> tuple[pd.DataFrame, int, int]:
        render_cfg = self.config.render
        desired_bars = int(clamp(render_cfg.chart_display_bars, render_cfg.min_display_bars, render_cfg.max_display_bars))
        end_index = len(frame) - 1
        start_index = max(0, end_index - desired_bars + 1)
        earliest_allowed = max(0, end_index - render_cfg.max_display_bars + 1)

        anchor_indices: list[int] = []
        if render_cfg.extend_window_for_active_pattern:
            for pattern in self._selected_patterns(analysis):
                for point in pattern.anchor_points:
                    bar_index = point.get("bar_index")
                    if isinstance(bar_index, int):
                        anchor_indices.append(bar_index)
        structure = analysis.modules.get("structure", {})
        for key in ("last_major_high", "last_major_low"):
            point = structure.get("features", {}).get(key)
            bar_index = point.get("bar_index") if isinstance(point, dict) else None
            if isinstance(bar_index, int):
                anchor_indices.append(bar_index)
        zone_module = analysis.modules.get("zones", {})
        for key in ("key_support_zone", "key_resistance_zone"):
            zone = zone_module.get(key)
            bar_index = zone.get("anchor_index") if isinstance(zone, dict) else None
            if isinstance(bar_index, int):
                anchor_indices.append(bar_index)
        if anchor_indices:
            anchor_start = max(earliest_allowed, min(anchor_indices) - 4)
            start_index = min(start_index, anchor_start)
        if end_index - start_index + 1 < render_cfg.min_display_bars:
            start_index = max(0, end_index - render_cfg.min_display_bars + 1)
        return frame.iloc[start_index : end_index + 1].copy(), start_index, end_index

    def _draw_candles(self, axis: plt.Axes, price_frame: pd.DataFrame) -> None:
        dates = mdates.date2num(list(price_frame.index.to_pydatetime()))
        width = 0.52
        for date_num, (_, row) in zip(dates, price_frame.iterrows()):
            color = THEME["bull"] if row["close"] >= row["open"] else THEME["bear"]
            axis.vlines(date_num, row["low"], row["high"], color=color, linewidth=1.0, alpha=0.95, zorder=2)
            lower = min(row["open"], row["close"])
            height = max(abs(row["close"] - row["open"]), 0.01)
            axis.add_patch(
                Rectangle(
                    (date_num - width / 2.0, lower),
                    width,
                    height,
                    facecolor=color,
                    edgecolor="#f8fafc",
                    linewidth=0.8,
                    alpha=0.88,
                    zorder=3,
                )
            )

    def _draw_emas(self, axis: plt.Axes, price_frame: pd.DataFrame) -> None:
        for column, color, label, alpha, width in (
            ("ema20", "#2563eb", "EMA 20", 0.95, 1.1),
            ("ema50", "#6d28d9", "EMA 50", 0.88, 1.6),
            ("ema200", "#b45309", "EMA 200", 0.90, 2.2),
        ):
            if column in price_frame:
                axis.plot(price_frame.index, price_frame[column], color=color, linewidth=width, alpha=alpha, label=label, zorder=2.6)

    def _should_show_ichimoku(self, analysis: ChartInterpretationResult) -> bool:
        setting = self.config.render.show_ichimoku
        if setting in {False, "false", "off", "never"}:
            return False
        if setting in {True, "true", "always"}:
            return True
        trend = analysis.modules.get("trend", {})
        ichimoku = trend.get("ichimoku_context", {})
        return trend.get("label") in {"range", "transition", "weak trend"} or bool(ichimoku.get("near_cloud"))

    def _draw_ichimoku(self, axis: plt.Axes, price_frame: pd.DataFrame) -> None:
        required = {"tenkan_sen", "kijun_sen", "cloud_top", "cloud_bottom"}
        if not required.issubset(price_frame.columns):
            return
        cloud_top = price_frame["cloud_top"].astype(float)
        cloud_bottom = price_frame["cloud_bottom"].astype(float)
        bullish_cloud = cloud_top >= cloud_bottom
        axis.fill_between(
            price_frame.index,
            cloud_bottom,
            cloud_top,
            where=bullish_cloud,
            color="#fecaca",
            alpha=0.10,
            interpolate=True,
            zorder=0.25,
        )
        axis.fill_between(
            price_frame.index,
            cloud_bottom,
            cloud_top,
            where=~bullish_cloud,
            color="#bfdbfe",
            alpha=0.10,
            interpolate=True,
            zorder=0.25,
        )
        axis.plot(price_frame.index, price_frame["tenkan_sen"], color="#0f766e", linewidth=1.0, alpha=0.72, zorder=1.0, label="Tenkan")
        axis.plot(price_frame.index, price_frame["kijun_sen"], color="#c2410c", linewidth=1.1, alpha=0.72, zorder=1.0, label="Kijun")
        axis.plot(price_frame.index, price_frame["cloud_top"], color="#dc2626", linewidth=0.9, alpha=0.65, zorder=0.95, label="Cloud top")
        axis.plot(price_frame.index, price_frame["cloud_bottom"], color="#2563eb", linewidth=0.9, alpha=0.65, zorder=0.95, label="Cloud base")

    def _draw_projection_region(self, axis: plt.Axes, price_frame: pd.DataFrame, future_points: list[dict[str, Any]]) -> None:
        if not future_points:
            return
        last_hist = price_frame.index[-1]
        future_end = pd.Timestamp(future_points[-1]["timestamp"])
        axis.axvspan(last_hist, future_end + pd.Timedelta(days=1), color="#eff3f7", alpha=0.52, zorder=0)

    def _draw_macd(self, axis: plt.Axes, price_frame: pd.DataFrame) -> None:
        if not {"macd_line", "macd_signal", "macd_hist"}.issubset(price_frame.columns):
            return
        hist = price_frame["macd_hist"].astype(float)
        colors = ["#3aa692" if value >= 0 else "#d97706" for value in hist]
        axis.bar(price_frame.index, hist, color=colors, width=0.8, alpha=0.45, zorder=1)
        axis.plot(price_frame.index, price_frame["macd_line"], color="#dc2626", linewidth=1.25, alpha=0.92, label="MACD", zorder=2.2)
        axis.plot(price_frame.index, price_frame["macd_signal"], color="#2563eb", linewidth=1.15, alpha=0.90, label="Signal", zorder=2.1)
        axis.legend(loc="upper left", fontsize=7.5, frameon=False, ncol=2, labelcolor=THEME["muted"])

    def _draw_relevant_zones(
        self,
        axis: plt.Axes,
        frame: pd.DataFrame,
        analysis: ChartInterpretationResult,
        price_frame: pd.DataFrame,
    ) -> None:
        zone_module = analysis.modules.get("zones", {})
        candidates = [zone_module.get("key_support_zone"), zone_module.get("key_resistance_zone")]
        relevant = [zone for zone in candidates if isinstance(zone, dict)]
        if not relevant:
            current_price = float(frame["close"].iloc[-1])
            zones = zone_module.get("zones", [])
            relevant = sorted(
                zones,
                key=lambda zone: (
                    abs(((zone["lower_bound"] + zone["upper_bound"]) / 2.0) - current_price),
                    -zone["strength_score"],
                ),
            )[: self.config.render.max_drawn_zones]
        left = mdates.date2num(price_frame.index[0])
        right = mdates.date2num(price_frame.index[-1])
        for zone in relevant:
            bullish = zone["zone_type"] in {"support", "volume_node"}
            color = THEME["bull"] if bullish else THEME["bear"]
            fill = THEME["zone_fill"] if bullish else THEME["zone_fill_bear"]
            axis.add_patch(
                Rectangle(
                    (left, zone["lower_bound"]),
                    right - left,
                    zone["upper_bound"] - zone["lower_bound"],
                    facecolor=fill,
                    edgecolor=color,
                    linewidth=1.0,
                    alpha=0.24,
                    zorder=0.4,
                )
            )
            axis.text(
                price_frame.index[0],
                zone["upper_bound"],
                f" {zone['label']} zone",
                fontsize=8,
                color=color,
                va="bottom",
                zorder=4,
            )

    def _draw_structure_levels(
        self,
        axis: plt.Axes,
        frame: pd.DataFrame,
        analysis: ChartInterpretationResult,
        start_index: int,
        end_index: int,
    ) -> None:
        if not self.config.render.show_structure_levels:
            return
        swings = analysis.modules.get("swings", {}).get("major", [])
        visible_swings = [item for item in swings if start_index <= item["bar_index"] <= end_index][-8:]
        for swing in visible_swings:
            timestamp = pd.Timestamp(swing["timestamp"])
            marker = "^" if swing["kind"] == "low" else "v"
            color = THEME["bull"] if swing["kind"] == "low" else THEME["bear"]
            axis.scatter(timestamp, swing["price"], marker=marker, color=color, s=42, zorder=5)

        structure = analysis.modules.get("structure", {})
        features = structure.get("features", {})
        for key, label, role in (
            ("last_major_high", "Major high", "resistance"),
            ("last_major_low", "Major low", "support"),
        ):
            point = features.get(key)
            if not isinstance(point, dict) or point.get("bar_index", -1) < start_index:
                continue
            self._draw_horizontal_marker(axis, frame, point["bar_index"], end_index, point["price"], label, role, "dashed")

        if structure.get("break_of_structure") == "bullish" and isinstance(features.get("last_major_high"), dict):
            point = features["last_major_high"]
            self._draw_horizontal_marker(axis, frame, point["bar_index"], end_index, point["price"], "BOS", "resistance", "solid")
        elif structure.get("break_of_structure") == "bearish" and isinstance(features.get("last_major_low"), dict):
            point = features["last_major_low"]
            self._draw_horizontal_marker(axis, frame, point["bar_index"], end_index, point["price"], "BOS", "support", "solid")

        if structure.get("change_of_character"):
            point = features.get("last_major_low") if analysis.primary_scenario.direction == "bearish" else features.get("last_major_high")
            if isinstance(point, dict):
                self._draw_horizontal_marker(axis, frame, point["bar_index"], end_index, point["price"], "CHoCH", "neutral", "solid")

    def _draw_trendlines(
        self,
        axis: plt.Axes,
        frame: pd.DataFrame,
        analysis: ChartInterpretationResult,
        start_index: int,
        end_index: int,
    ) -> None:
        swings = analysis.modules.get("swings", {}).get("medium", []) or analysis.modules.get("swings", {}).get("major", [])
        atr = float(frame["atr"].iloc[-1]) if "atr" in frame else float((frame["high"] - frame["low"]).tail(20).mean())
        primary_direction = analysis.primary_scenario.direction
        include_lows = primary_direction in {"bullish", "neutral"}
        include_highs = primary_direction in {"bearish", "neutral"}
        if analysis.strongest_alternative is not None and analysis.strongest_alternative.direction != primary_direction:
            include_lows = True
            include_highs = True
        trendline_specs = []
        if include_lows:
            trendline_specs.append(self._trendline_from_swings(frame, swings, start_index, end_index, "low", atr))
        if include_highs:
            trendline_specs.append(self._trendline_from_swings(frame, swings, start_index, end_index, "high", atr))
        for spec in trendline_specs:
            if spec is None:
                continue
            self._plot_line(axis, pd.Timestamp(spec["x0"]), pd.Timestamp(spec["x1"]), spec["y0"], spec["y1"], spec["color"], "-", 1.1, spec["label"])

    def _draw_pattern_lines(
        self,
        axis: plt.Axes,
        frame: pd.DataFrame,
        analysis: ChartInterpretationResult,
        start_index: int,
        end_index: int,
    ) -> None:
        for pattern in self._selected_patterns(analysis):
            if pattern.freshness < self.config.patterns.stale_pattern_freshness:
                continue
            for line in pattern.draw_lines:
                self._plot_pattern_line(axis, frame, line, start_index, end_index)

    def _draw_candlestick_signals(
        self,
        axis: plt.Axes,
        frame: pd.DataFrame,
        analysis: ChartInterpretationResult,
        start_index: int,
    ) -> None:
        signals = analysis.modules.get("confirmation", {}).get("candlestick_signals", [])
        if not signals:
            return
        for signal in signals[:2]:
            bar_index = int(signal.get("bar_index", -1))
            if bar_index < start_index or bar_index >= len(frame):
                continue
            timestamp = frame.index[bar_index]
            row = frame.iloc[bar_index]
            bullish = signal.get("direction") == "bullish"
            y = float(row["low"]) if bullish else float(row["high"])
            marker = "^" if bullish else "v"
            color = THEME["bull"] if bullish else THEME["bear"]
            offset = -8 if bullish else 8
            va = "top" if bullish else "bottom"
            axis.scatter(timestamp, y, marker=marker, s=54, color=color, zorder=5.2, edgecolors="white", linewidths=0.6)
            axis.annotate(
                signal.get("pattern_name", ""),
                xy=(timestamp, y),
                xytext=(0, offset),
                textcoords="offset points",
                ha="center",
                va=va,
                fontsize=7.5,
                color=color,
                zorder=5.3,
            )

    def _draw_targets(self, axis: plt.Axes, last_date: pd.Timestamp, analysis: ChartInterpretationResult) -> None:
        primary = analysis.primary_scenario
        if primary.invalidation_level is not None:
            axis.axhline(primary.invalidation_level, color=THEME["invalidation"], linewidth=1.1, linestyle="--", alpha=0.9, zorder=1.5)
            relation = "<" if primary.direction == "bullish" else ">" if primary.direction == "bearish" else ""
            axis.text(
                last_date,
                primary.invalidation_level,
                f" invalidation {relation} {primary.invalidation_level:,.2f}".rstrip(),
                color=THEME["invalidation"],
                fontsize=8,
                va="bottom",
            )
        for label, zone, color in (("Target 1", primary.target_zone_1, THEME["target_1"]), ("Target 2", primary.target_zone_2, THEME["target_2"])):
            if zone is None:
                continue
            left = mdates.date2num(last_date)
            right = left + 12.0
            axis.add_patch(
                Rectangle(
                    (left, zone["low"]),
                    right - left,
                    zone["high"] - zone["low"],
                    facecolor=color,
                    alpha=0.10,
                    edgecolor=color,
                    linewidth=0.9,
                    zorder=0.8,
                )
            )
            axis.text(last_date, zone["mid"], f" {label} {zone['mid']:,.2f}", color=color, fontsize=8, va="bottom")

    def _draw_projection(self, axis: plt.Axes, projection: dict[str, Any]) -> None:
        def _xy(items: list[dict[str, Any]]) -> tuple[list[pd.Timestamp], list[float]]:
            return [pd.Timestamp(item["timestamp"]) for item in items], [float(item["price"]) for item in items]

        upper_x, upper_y = _xy(projection["upper_band"])
        lower_x, lower_y = _xy(projection["lower_band"])
        base_x, base_y = _xy(projection["base_path"])
        bull_x, bull_y = _xy(projection["bullish_path"])
        bear_x, bear_y = _xy(projection["bearish_path"])

        if upper_x and lower_x:
            axis.fill_between(upper_x, lower_y, upper_y, color=THEME["projection"], alpha=0.10, zorder=0.2)
        axis.plot(base_x, base_y, color=THEME["ink"], linewidth=1.8, linestyle="-", alpha=0.85, label="Base path", zorder=1.2)
        axis.plot(bull_x, bull_y, color=THEME["bull"], linewidth=1.2, linestyle=(0, (4, 3)), alpha=0.85, label="Bullish path", zorder=1.1)
        axis.plot(bear_x, bear_y, color="#b42318", linewidth=1.2, linestyle=(0, (4, 3)), alpha=0.85, label="Bearish path", zorder=1.1)
        if base_x and base_y:
            axis.text(base_x[-1], base_y[-1], " base", color=THEME["ink"], fontsize=8, va="bottom")
        if bull_x and bull_y:
            axis.text(bull_x[-1], bull_y[-1], " bull", color=THEME["bull"], fontsize=8, va="bottom")
        if bear_x and bear_y:
            axis.text(bear_x[-1], bear_y[-1], " bear", color="#b42318", fontsize=8, va="top")

    def _selected_patterns(self, analysis: ChartInterpretationResult) -> list[PatternSignal]:
        patterns = sorted(analysis.active_patterns, key=lambda item: (-item.relevance, -item.confidence, item.pattern_name))
        limit = min(self.config.render.max_drawn_patterns, self.config.render.max_patterns_displayed)
        return patterns[:limit]

    def _plot_pattern_line(
        self,
        axis: plt.Axes,
        frame: pd.DataFrame,
        line: dict[str, Any],
        window_start: int,
        window_end: int,
    ) -> None:
        original_start = int(line["start_index"])
        original_end = int(line["end_index"])
        if original_end < window_start:
            return
        start_index = max(window_start, original_start)
        end_index = window_end if line.get("extend_right") else min(window_end, original_end)
        if start_index >= len(frame) or end_index >= len(frame) or start_index > end_index:
            return
        span = max(original_end - original_start, 1)
        slope = (float(line["end_price"]) - float(line["start_price"])) / span
        start_price = float(line["start_price"]) + slope * (start_index - original_start)
        end_price = float(line["start_price"]) + slope * (end_index - original_start)
        color = self._role_color(line.get("role", "neutral"))
        linestyle = "-" if line.get("style") == "solid" else "--" if line.get("style") == "dashed" else ":"
        self._plot_line(
            axis,
            frame.index[start_index],
            frame.index[end_index],
            start_price,
            end_price,
            color,
            linestyle,
            1.2,
            line.get("label", ""),
            alpha=0.85,
        )

    def _plot_line(
        self,
        axis: plt.Axes,
        x0: pd.Timestamp,
        x1: pd.Timestamp,
        y0: float,
        y1: float,
        color: str,
        linestyle: str,
        linewidth: float,
        label: str,
        alpha: float = 0.85,
    ) -> None:
        axis.plot([x0, x1], [y0, y1], color=color, linestyle=linestyle, linewidth=linewidth, alpha=alpha, zorder=4)
        axis.text(x1, y1, f" {label}", color=color, fontsize=8, va="bottom")

    def _trendline_from_swings(
        self,
        frame: pd.DataFrame,
        swings: list[dict[str, Any]],
        start_index: int,
        end_index: int,
        kind: str,
        atr: float,
    ) -> dict[str, Any] | None:
        relevant = [item for item in swings if item["kind"] == kind and start_index <= item["bar_index"] <= end_index][-3:]
        if len(relevant) < 3:
            return None
        first, middle, last = relevant[0], relevant[1], relevant[2]
        if kind == "low" and not (first["price"] < middle["price"] < last["price"]):
            return None
        if kind == "high" and not (first["price"] > middle["price"] > last["price"]):
            return None
        projected_middle = self._line_value(first["bar_index"], first["price"], last["bar_index"], last["price"], middle["bar_index"])
        if abs(projected_middle - middle["price"]) > atr * 0.7:
            return None
        projected_end = self._line_value(first["bar_index"], first["price"], last["bar_index"], last["price"], end_index)
        return {
            "x0": frame.index[first["bar_index"]],
            "x1": frame.index[end_index],
            "y0": first["price"],
            "y1": projected_end,
            "color": THEME["bull"] if kind == "low" else THEME["bear"],
            "label": "Rising support" if kind == "low" else "Falling resistance",
        }

    def _draw_horizontal_marker(
        self,
        axis: plt.Axes,
        frame: pd.DataFrame,
        start_index: int,
        end_index: int,
        price: float,
        label: str,
        role: str,
        style: str,
    ) -> None:
        color = self._role_color(role)
        linestyle = "-" if style == "solid" else "--"
        axis.plot([frame.index[start_index], frame.index[end_index]], [price, price], color=color, linewidth=1.0, linestyle=linestyle, alpha=0.8, zorder=1.3)
        axis.text(frame.index[end_index], price, f" {label}", color=color, fontsize=8, va="bottom")

    @staticmethod
    def _line_value(start_index: int, start_price: float, end_index: int, end_price: float, target_index: int) -> float:
        span = max(end_index - start_index, 1)
        slope = (end_price - start_price) / span
        return start_price + slope * (target_index - start_index)

    @staticmethod
    def _role_color(role: str) -> str:
        if role == "support":
            return THEME["bull"]
        if role == "resistance":
            return THEME["bear"]
        return THEME["neutral"]

    def _report_levels(self, payload: dict[str, Any]) -> str:
        primary = payload["primary_scenario"]
        blocks = [
            ("Invalidation", self._format_price(payload.get("invalidation_level"))),
            ("Target Zone 1", self._format_zone(primary.get("target_zone_1"))),
            ("Target Zone 2", self._format_zone(primary.get("target_zone_2"))),
        ]
        return "".join(
            f'<div class="metric" style="margin-bottom:10px;"><div class="label">{label}</div><div class="value">{value}</div></div>'
            for label, value in blocks
        )


    def _pattern_block(self, patterns: list[dict[str, Any]]) -> str:
        if not patterns:
            return '<p class="subtle">No active pattern is strong enough to highlight.</p>'
        items = []
        for pattern in patterns[:3]:
            items.append(
                f'<div class="metric" style="margin-bottom:10px;">'
                f'<div class="label">{pattern["pattern_name"]}</div>'
                f'<div class="value">{pattern["direction"]} | confidence {pattern["confidence"]:.2f}</div>'
                f'<div class="subtle">{" ".join(pattern.get("explanation", []))}</div>'
                f"</div>"
            )
        return "".join(items)

    def _event_block(self, events: list[dict[str, Any]]) -> str:
        if not events:
            return '<p class="subtle">No recent event sequence was recorded.</p>'
        items = []
        for event in events[:5]:
            items.append(
                f'<div class="metric" style="margin-bottom:10px;">'
                f'<div class="label">{event["event_type"]}</div>'
                f'<div class="value">{event["details"]}</div>'
                f'<div class="subtle">{event["timestamp"]} | strength {event["strength"]:.2f}</div>'
                f"</div>"
            )
        return "".join(items)

    @staticmethod
    def _format_price(value: float | None) -> str:
        return "-" if value is None else f"{float(value):,.2f}"

    @staticmethod
    def _format_zone(zone: dict[str, Any] | None) -> str:
        if not zone:
            return "-"
        return f'{float(zone["low"]):,.2f} to {float(zone["high"]):,.2f}'
