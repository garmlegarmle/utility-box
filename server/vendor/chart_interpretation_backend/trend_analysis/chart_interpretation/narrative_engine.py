"""Natural-language report generation for chart interpretation."""

from __future__ import annotations

from typing import Any

from .config import ChartInterpretationConfig
from .models import PatternSignal, ScenarioCandidate


class NarrativeEngine:
    """Convert analytical state into concise analyst-style commentary."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def build(
        self,
        *,
        trend: dict[str, Any],
        higher_tf: dict[str, Any] | None,
        structure: dict[str, Any],
        location_state: str,
        patterns: list[PatternSignal],
        confirmation: dict[str, Any],
        primary: ScenarioCandidate,
        strongest_alternative: ScenarioCandidate | None,
        confidence: float,
    ) -> dict[str, Any]:
        confidence_label = self.confidence_label(confidence)
        summary = self._summary_text(
            trend=trend,
            higher_tf=higher_tf,
            structure=structure,
            location_state=location_state,
            patterns=patterns,
            confirmation=confirmation,
        )
        primary_text = self._primary_text(
            primary=primary,
            trend=trend,
            higher_tf=higher_tf,
            structure=structure,
            location_state=location_state,
            patterns=patterns,
            confirmation=confirmation,
            confidence_label=confidence_label,
        )
        alternative_text = self._alternative_text(
            primary=primary,
            strongest_alternative=strongest_alternative,
            higher_tf=higher_tf,
            structure=structure,
            location_state=location_state,
        )
        risk_notes = self._risk_notes(
            primary=primary,
            strongest_alternative=strongest_alternative,
            higher_tf=higher_tf,
            structure=structure,
            location_state=location_state,
            confidence=confidence,
            patterns=patterns,
        )
        checklist = self._confirmation_checklist(primary, strongest_alternative, patterns, trend=trend, confirmation=confirmation)
        explanation = self._explanation_lines(summary, primary_text, alternative_text)
        return {
            "summary_text": summary,
            "confidence_label": confidence_label,
            "primary_scenario_explanation": primary_text,
            "alternative_scenario_explanation": alternative_text,
            "risk_notes": risk_notes,
            "confirmation_checklist": checklist,
            "explanation": explanation,
        }

    @staticmethod
    def confidence_label(score: float) -> str:
        if score < 0.35:
            return "low conviction"
        if score < 0.65:
            return "moderate conviction"
        return "strong conviction"

    def _summary_text(
        self,
        *,
        trend: dict[str, Any],
        higher_tf: dict[str, Any] | None,
        structure: dict[str, Any],
        location_state: str,
        patterns: list[PatternSignal],
        confirmation: dict[str, Any],
    ) -> str:
        sentences: list[str] = []
        local_bias = self._bias_word(trend.get("label", "transition"), trend.get("score", 0.0))
        structure_label = structure.get("label", "transition")
        pattern = patterns[0] if patterns else None
        ema_context = trend.get("ema_context", {})
        ichimoku = trend.get("ichimoku_context", {})

        if higher_tf:
            higher_bias = self._bias_word(higher_tf.get("label", "transition"), higher_tf.get("score", 0.0))
            if higher_bias != "neutral" and higher_bias != local_bias and local_bias != "neutral":
                sentences.append(
                    f"The higher timeframe trend still leans {higher_bias}, but the recent daily structure has turned more {self._structure_tone(structure_label)}."
                )
            elif higher_bias != "neutral":
                sentences.append(
                    f"The broader backdrop still leans {higher_bias}, and the daily chart is mostly trading in the same direction."
                )
            else:
                sentences.append(
                    f"The bigger picture is mixed, so the recent daily structure is doing more of the analytical work here."
                )
        else:
            if local_bias == "neutral":
                sentences.append("The daily chart is still trapped between range conditions and transition.")
            else:
                sentences.append(f"The daily chart still leans {local_bias}, although the recent structure needs more confirmation.")

        sentences.append(self._location_sentence(location_state, pattern))
        tone_sentence = self._dry_tone_sentence(
            location_state=location_state,
            pattern=pattern,
            structure_label=structure_label,
        )
        if tone_sentence:
            sentences.append(tone_sentence)
        ema_sentence = self._ema_sentence(ema_context)
        if ema_sentence:
            sentences.append(ema_sentence)
        cloud_sentence = self._ichimoku_sentence(ichimoku, trend.get("label", "transition"))
        if cloud_sentence:
            sentences.append(cloud_sentence)
        sentences.append(self._momentum_sentence(confirmation, structure_label))
        candle_sentence = self._candle_sentence(confirmation, location_state)
        if candle_sentence:
            sentences.append(candle_sentence)
        elif pattern is not None and pattern.pattern_name in {"double top", "double bottom", "bull flag", "bear flag", "symmetrical triangle", "ascending triangle", "descending triangle", "range box", "breakout retest"}:
            sentences.append(self._pattern_sentence(pattern))

        if not candle_sentence and structure_label == "structure weakening":
            sentences.append("This still looks more like a correction than a confirmed reversal unless support breaks.")
        return " ".join(self._dedupe_sentences(sentences)[:4])

    def _primary_text(
        self,
        *,
        primary: ScenarioCandidate,
        trend: dict[str, Any],
        higher_tf: dict[str, Any] | None,
        structure: dict[str, Any],
        location_state: str,
        patterns: list[PatternSignal],
        confirmation: dict[str, Any],
        confidence_label: str,
    ) -> str:
        pattern = patterns[0] if patterns else None
        local_bias = self._bias_word(trend.get("label", "transition"), trend.get("score", 0.0))
        structure_label = structure.get("label", "transition")
        ema_context = trend.get("ema_context", {})
        ichimoku = trend.get("ichimoku_context", {})
        lead = f"The favored path is {primary.name} with {confidence_label}."
        reasons = []
        if structure_label in {"bullish structure intact", "bearish structure intact", "break of structure"}:
            reasons.append(f"Price structure still looks more like {self._structure_tone(structure_label)} than a full reversal.")
        if location_state in {"near support", "retest zone", "near resistance", "breakout zone"}:
            reasons.append(self._location_reason(location_state))
        tone_reason = self._dry_primary_reason(
            location_state=location_state,
            pattern=pattern,
            primary_name=primary.name,
            structure_label=structure_label,
        )
        if tone_reason:
            reasons.append(tone_reason)
        ema_reason = self._ema_primary_reason(primary.direction, ema_context)
        if ema_reason:
            reasons.append(ema_reason)
        candle_reason = self._candle_primary_reason(primary.direction, confirmation, location_state)
        if candle_reason:
            reasons.append(candle_reason)
        if pattern is not None and pattern.confidence >= 0.45:
            reasons.append(f"The active setup still looks closest to a {pattern.pattern_name}.")
        if higher_tf and self._bias_word(higher_tf.get("label", "transition"), higher_tf.get("score", 0.0)) == local_bias and local_bias != "neutral":
            reasons.append("That view has some help from the larger timeframe trend.")
        elif higher_tf and local_bias != "neutral":
            reasons.append("The larger timeframe does not fully agree yet, so follow-through still matters.")
        cloud_reason = self._ichimoku_primary_reason(primary.direction, ichimoku)
        if cloud_reason:
            reasons.append(cloud_reason)
        if abs(float(confirmation.get("rsi_bias", 0.0))) < 0.35:
            reasons.append("Momentum is stabilizing rather than strongly stretched.")
        analogy = self._analogy_sentence(
            location_state=location_state,
            pattern=pattern,
            primary_name=primary.name,
            structure_label=structure_label,
        )
        if analogy:
            reasons.append(analogy)
        return " ".join([lead, *self._dedupe_sentences(reasons)[:3]])

    def _alternative_text(
        self,
        *,
        primary: ScenarioCandidate,
        strongest_alternative: ScenarioCandidate | None,
        higher_tf: dict[str, Any] | None,
        structure: dict[str, Any],
        location_state: str,
    ) -> str:
        if strongest_alternative is None:
            return "There is no strong competing scenario yet, so the chart mainly hinges on whether the current structure holds."

        pieces = [f"The main alternative is {strongest_alternative.name}."]
        if strongest_alternative.direction != primary.direction:
            pieces.append("That would gain weight if the current structure loses its last nearby support or resistance reference.")
        if structure.get("change_of_character"):
            pieces.append("A genuine change of character would make the alternative scenario more credible.")
        elif location_state in {"near resistance", "near support"}:
            pieces.append("This area is important because failed reactions from the current zone would shift the read quickly.")
        if higher_tf and primary.direction != strongest_alternative.direction:
            pieces.append("The higher timeframe backdrop should still be respected before treating it as more than a corrective move.")
        if primary.direction == "bullish" and structure.get("label") in {"structure weakening", "change of character"}:
            pieces.append("If price starts losing the recent higher-low structure, the bullish read would weaken quickly.")
        if primary.direction == "bearish" and structure.get("label") in {"break of structure", "change of character"}:
            pieces.append("If price reclaims the last breakdown area cleanly, the bearish read would lose traction.")
        return " ".join(self._dedupe_sentences(pieces)[:4])

    def _risk_notes(
        self,
        *,
        primary: ScenarioCandidate,
        strongest_alternative: ScenarioCandidate | None,
        higher_tf: dict[str, Any] | None,
        structure: dict[str, Any],
        location_state: str,
        confidence: float,
        patterns: list[PatternSignal],
    ) -> list[str]:
        notes = list(primary.risk_flags)
        primary_bias = primary.direction
        if higher_tf:
            higher_bias = self._bias_word(higher_tf.get("label", "transition"), higher_tf.get("score", 0.0))
            if primary_bias in {"bullish", "bearish"} and higher_bias not in {"neutral", primary_bias}:
                notes.append("Higher timeframe bias still leans the other way.")
        if structure.get("compression"):
            notes.append("Compression can break sharply in either direction.")
        if location_state == "overextended zone":
            notes.append("Price is already stretched from nearby value.")
        if strongest_alternative is not None and abs(primary.score - strongest_alternative.score) < 0.12:
            notes.append("Scenario ranking is still fairly tight.")
        if confidence < 0.35:
            notes.append("Conviction stays low until the next structure break is confirmed.")
        if patterns and patterns[0].freshness < 0.5:
            notes.append("The lead pattern is starting to lose freshness.")
        deduped: list[str] = []
        for note in notes:
            if note and note not in deduped:
                deduped.append(note)
        return deduped[:5]

    @staticmethod
    def _confirmation_checklist(
        primary: ScenarioCandidate,
        strongest_alternative: ScenarioCandidate | None,
        patterns: list[PatternSignal],
        trend: dict[str, Any] | None = None,
        confirmation: dict[str, Any] | None = None,
    ) -> list[str]:
        checklist = list(primary.confirmation_needed)
        if patterns:
            pattern = patterns[0]
            if pattern.breakout_level is not None:
                checklist.append(f"Respect the breakout reference near {pattern.breakout_level:,.2f}")
            if pattern.invalidation_level is not None:
                checklist.append(f"Avoid losing {pattern.invalidation_level:,.2f} on a closing basis")
        ema_context = (trend or {}).get("ema_context", {}) if trend else {}
        ichimoku = (trend or {}).get("ichimoku_context", {}) if trend else {}
        candle = NarrativeEngine._lead_candle(confirmation or {})
        if primary.direction == "bullish":
            if ema_context.get("pullback_to_ema20"):
                checklist.append("Hold the 20 EMA area on pullbacks")
            elif ema_context.get("above_ema200"):
                checklist.append("Stay above the 50 EMA while the larger trend stays constructive")
            if ichimoku.get("regime") == "inside cloud":
                checklist.append("Watch whether price gains acceptance above the cloud")
            if candle and candle.get("direction") == "bullish":
                checklist.append("Let the latest bullish candle get follow-through")
        elif primary.direction == "bearish":
            if ema_context.get("lost_ema50") or ema_context.get("below_ema200"):
                checklist.append("Keep price below the 50 EMA on rebounds")
            if ichimoku.get("regime") == "inside cloud":
                checklist.append("Watch whether price loses the cloud support area")
            if candle and candle.get("direction") == "bearish":
                checklist.append("Do not let the latest bearish rejection get reclaimed")
        if strongest_alternative and strongest_alternative.direction != primary.direction:
            checklist.append("Watch whether the strongest alternative starts taking control of the next swing")
        deduped: list[str] = []
        for item in checklist:
            if item not in deduped:
                deduped.append(item)
        return deduped[:5]

    @staticmethod
    def _explanation_lines(summary: str, primary_text: str, alternative_text: str) -> list[str]:
        return [summary, primary_text, alternative_text]

    @staticmethod
    def _bias_word(label: str, score: float) -> str:
        if label == "uptrend" or score > 0.18:
            return "bullish"
        if label == "downtrend" or score < -0.18:
            return "bearish"
        return "neutral"

    @staticmethod
    def _structure_tone(label: str) -> str:
        mapping = {
            "bullish structure intact": "constructive continuation",
            "bearish structure intact": "downward continuation",
            "range structure": "a range-bound market",
            "compression": "a tightening range",
            "structure weakening": "a correction",
            "break of structure": "a fresh expansion",
            "change of character": "a possible reversal",
            "transition": "mixed",
        }
        return mapping.get(label, "mixed")

    def _location_sentence(self, location_state: str, pattern: PatternSignal | None) -> str:
        if location_state == "near support":
            return "Price is sitting near support, so this zone matters if buyers want the chart to stay constructive."
        if location_state == "near resistance":
            return "Price is pressing into resistance, so acceptance above this area still needs to be earned."
        if location_state == "retest zone":
            return "Price is testing a prior breakout area, which is often where continuation either proves itself or fails."
        if location_state == "breakout zone":
            return "Price is trying to leave a prior balance area, so follow-through is more important than the first push."
        if location_state == "overextended zone":
            return "Price is stretched away from nearby support, so chasing strength here carries more risk."
        if pattern is not None and "triangle" in pattern.pattern_name:
            return "Price is coiling into a decision point, so a directional move may not be far away."
        return "Price is still trading inside the middle of the current structure rather than at a clean decision level."

    @staticmethod
    def _location_reason(location_state: str) -> str:
        mapping = {
            "near support": "Current location matters because price is testing nearby support.",
            "near resistance": "Current location matters because price is pressing into nearby resistance.",
            "retest zone": "Current location matters because the retest area still has to hold.",
            "breakout zone": "Current location matters because the breakout area still needs acceptance.",
        }
        return mapping.get(location_state, "Current location still matters for the next directional move.")

    def _momentum_sentence(self, confirmation: dict[str, Any], structure_label: str) -> str:
        rsi_bias = float(confirmation.get("rsi_bias", 0.0))
        relative_volume = float(confirmation.get("relative_volume", 1.0))
        breakout_quality = float(confirmation.get("breakout_quality", 0.5))
        if rsi_bias > 0.35:
            momentum_text = "Momentum is still leaning higher"
        elif rsi_bias < -0.35:
            momentum_text = "Momentum is still leaning lower"
        else:
            momentum_text = "Momentum has stabilized"
        if structure_label == "compression":
            volume_text = "while the chart remains compressed"
        elif relative_volume >= 1.2 and breakout_quality >= 0.65:
            volume_text = "and participation has improved"
        elif relative_volume < 0.95:
            volume_text = "but volume is still not doing much"
        else:
            volume_text = "with mixed confirmation underneath the surface"
        return f"{momentum_text}, {volume_text}."

    @staticmethod
    def _pattern_sentence(pattern: PatternSignal) -> str:
        if pattern.pattern_name == "bull flag":
            return "The recent pullback still looks more like a bull flag than a larger breakdown."
        if pattern.pattern_name == "bear flag":
            return "The bounce still looks more like a bear flag than a durable reversal."
        if pattern.pattern_name == "double top":
            return "The chart has built a double-top style ceiling, so the neckline matters."
        if pattern.pattern_name == "double bottom":
            return "The chart is trying to base through a double-bottom structure, so the neckline remains the trigger."
        if pattern.pattern_name == "symmetrical triangle":
            return "The chart is tightening into a symmetrical triangle, which usually resolves with expansion."
        if pattern.pattern_name == "ascending triangle":
            return "The chart is leaning against resistance while lows continue to rise underneath."
        if pattern.pattern_name == "descending triangle":
            return "The chart is leaning on support while rally attempts keep losing height."
        if pattern.pattern_name == "range box":
            return "The market is still respecting a range box, so the edges matter more than the middle."
        if pattern.pattern_name == "breakout retest":
            return "The current pullback still looks more like a retest than a failed move so far."
        return f"The current setup is still best described as a {pattern.pattern_name}."

    @staticmethod
    def _dedupe_sentences(items: list[str]) -> list[str]:
        deduped: list[str] = []
        for item in items:
            if item and item not in deduped:
                deduped.append(item)
        return deduped

    @staticmethod
    def _lead_candle(confirmation: dict[str, Any]) -> dict[str, Any] | None:
        signals = confirmation.get("candlestick_signals", [])
        return signals[0] if signals else None

    def _ema_sentence(self, ema_context: dict[str, Any]) -> str | None:
        if ema_context.get("pullback_to_ema20"):
            return "Price is pulling back toward the 20 EMA while holding above support, which still looks more like a controlled retracement."
        if ema_context.get("lost_ema50"):
            return "Price has slipped below the 50 EMA, so the recent structure has clearly weakened."
        if ema_context.get("ema_stack_bullish") and ema_context.get("above_ema200"):
            return "Price remains above the 200 EMA, so the larger directional bias is still constructive."
        if ema_context.get("ema_stack_bearish") and ema_context.get("below_ema200"):
            return "Price remains below the 200 EMA, so the larger directional bias is still heavy."
        return None

    def _ichimoku_sentence(self, ichimoku: dict[str, Any], trend_label: str) -> str | None:
        regime = ichimoku.get("regime")
        if regime == "inside cloud":
            return "Price is trading around the cloud, which fits a less decisive trend regime."
        if regime == "above cloud" and trend_label in {"transition", "weak trend"}:
            return "Price is back above the cloud, but buyers still need to turn that into support."
        if regime == "below cloud" and trend_label in {"transition", "weak trend"}:
            return "Price is still below the cloud, so rebounds can run into overhead supply."
        return None

    def _candle_sentence(self, confirmation: dict[str, Any], location_state: str) -> str | None:
        candle = self._lead_candle(confirmation)
        if candle is None:
            return None
        name = candle.get("pattern_name")
        direction = candle.get("direction")
        if name == "bullish engulfing":
            return "The latest candle printed a bullish engulfing pattern at an important area."
        if name == "bearish engulfing":
            return "The latest candle printed a bearish engulfing pattern near resistance."
        if name == "pin bar" and direction == "bullish":
            return "The latest candle rejected lower prices, which matters if support is going to hold."
        if name == "pin bar" and direction == "bearish":
            return "The latest candle rejected higher prices, so buyers still have overhead supply to clear."
        if name == "inside bar":
            return "The latest candle is an inside bar, so the market is still compressing near the decision area."
        if name == "breakout candle" and direction == "bullish":
            return "The latest candle expanded to the upside, but the breakout still needs follow-through."
        if name == "breakout candle" and direction == "bearish":
            return "The latest candle expanded to the downside, and that keeps pressure on nearby support."
        if name == "exhaustion candle" and direction == "bearish":
            return "The latest candle shows upside exhaustion, which can matter if resistance holds."
        if name == "exhaustion candle" and direction == "bullish":
            return "The latest candle rejected the downside sharply, which can matter if support holds."
        if location_state in {"near support", "near resistance"}:
            return "The latest candle behavior matters because price is already sitting at a nearby decision zone."
        return None

    def _ema_primary_reason(self, direction: str, ema_context: dict[str, Any]) -> str | None:
        if direction == "bullish" and ema_context.get("pullback_to_ema20"):
            return "Price is pulling back into the 20 EMA rather than losing the broader support structure."
        if direction == "bullish" and ema_context.get("above_ema200"):
            return "Price is still above the 200 EMA, so the larger bias remains supportive."
        if direction == "bearish" and ema_context.get("lost_ema50"):
            return "Price has lost the 50 EMA, which fits a weaker short-term structure."
        if direction == "bearish" and ema_context.get("below_ema200"):
            return "Price remains below the 200 EMA, so the larger bias still leans lower."
        return None

    def _ichimoku_primary_reason(self, direction: str, ichimoku: dict[str, Any]) -> str | None:
        regime = ichimoku.get("regime")
        if direction == "bullish" and regime == "above cloud":
            return "Price is holding above the cloud, which supports the idea of support sitting underneath the move."
        if direction == "bearish" and regime == "below cloud":
            return "Price is staying below the cloud, so rebounds still look vulnerable."
        if regime == "inside cloud":
            return "Price is still in the cloud, so trend conviction should stay measured."
        return None

    def _candle_primary_reason(self, direction: str, confirmation: dict[str, Any], location_state: str) -> str | None:
        candle = self._lead_candle(confirmation)
        if candle is None:
            return None
        if direction == "bullish" and candle.get("direction") == "bullish" and location_state in {"near support", "retest zone", "breakout zone"}:
            return "The latest candle behavior supports the bullish case, but only if buyers get follow-through."
        if direction == "bearish" and candle.get("direction") == "bearish" and location_state in {"near resistance", "retest zone", "breakout zone"}:
            return "The latest candle behavior supports the bearish case, but only if sellers press the next swing."
        return None

    def _analogy_sentence(
        self,
        *,
        location_state: str,
        pattern: PatternSignal | None,
        primary_name: str | None,
        structure_label: str,
    ) -> str | None:
        if not self.config.narrative.use_pop_culture_analogies:
            return None
        if pattern is not None:
            if pattern.pattern_name == "bull flag":
                return "It looks more like a shonen reset scene, where the hero takes one step back before charging again."
            if pattern.pattern_name == "bear flag":
                return "It looks more like the villain's brief comeback montage than a true turn in the story."
            if pattern.pattern_name in {"symmetrical triangle", "ascending triangle", "descending triangle"}:
                return "The chart feels like a thriller hallway scene: quiet for a while, and then suddenly not quiet."
            if pattern.pattern_name == "breakout retest":
                return "This part looks like a heist movie checkpoint, where clearing the door matters less than holding the exit."
            if pattern.pattern_name == "range box":
                return "Right now it feels more like a boxing movie feeling-out round than a finishing punch."
            if pattern.pattern_name in {"double top", "double bottom"}:
                return "This still reads like a plot-twist setup, not the final scene."
        if primary_name == "breakout in progress":
            return "It is a bit like an escape movie: getting over the wall is one thing, staying out is the real test."
        if primary_name == "bullish continuation after pullback":
            return "It looks more like the hero regrouping between fights than the story changing sides."
        if primary_name == "bearish continuation":
            return "It feels more like the second act pressure scene, where each rebound gets pushed back down."
        if primary_name == "reversal candidate":
            return "For now it looks more like a possible plot twist than the final reveal."
        if structure_label == "compression":
            return "The tape has the feel of an anime power-up pause, where not much happens until everything happens at once."
        if location_state in {"near support", "near resistance"}:
            return "This area has the feel of the movie standoff before the first real move."
        return None

    def _dry_tone_sentence(
        self,
        *,
        location_state: str,
        pattern: PatternSignal | None,
        structure_label: str,
    ) -> str | None:
        if not self.config.narrative.use_dry_analyst_tone:
            return None
        if location_state == "near support":
            return "Support is doing its job for now, and the 'for now' part matters."
        if location_state == "near resistance":
            return "Resistance is still close, and looking strong is not the same thing as getting through."
        if location_state == "breakout zone":
            return "The first break is not the point; holding above it is."
        if location_state == "retest zone":
            return "Retests are where good stories survive and bad ones end early."
        if structure_label == "compression":
            return "Quiet tape usually stays quiet until it doesn't."
        if structure_label == "structure weakening":
            return "It looks weaker, yes, but confirmed reversal is another matter."
        if pattern is not None and pattern.pattern_name == "range box":
            return "Inside a box, dramatic narratives usually waste everyone's time."
        return None

    def _dry_primary_reason(
        self,
        *,
        location_state: str,
        pattern: PatternSignal | None,
        primary_name: str,
        structure_label: str,
    ) -> str | None:
        if not self.config.narrative.use_dry_analyst_tone:
            return None
        if primary_name == "breakout in progress":
            return "The move is fine so far, but staying above the break is the actual exam."
        if primary_name == "bullish continuation after pullback":
            return "So far this still looks like a reset rather than a script change."
        if primary_name == "bearish continuation":
            return "Bounces can happen inside a down move, but keeping the rebound is the harder ask."
        if primary_name == "reversal candidate":
            return "Possible turn, yes, but confirmed turn is another matter."
        if primary_name == "breakout likely to fail":
            return "Failed moves often look fine for a moment, and then they don't."
        if primary_name == "range mean reversion":
            return "Inside the box, dramatic narratives usually waste everyone's time."
        if location_state == "near resistance":
            return "This can still work higher. It just has to earn it here."
        if location_state == "near support":
            return "This can still hold. Losing this area would change the tone quickly."
        if pattern is not None and pattern.pattern_name == "breakout retest":
            return "Retests look clean right up until they fail, so this level matters."
        if structure_label == "compression":
            return "Compressed charts can look calm right before they stop being calm."
        return None
