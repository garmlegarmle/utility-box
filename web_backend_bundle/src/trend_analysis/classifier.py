"""Final regime classification and summary generation."""

from __future__ import annotations

from typing import Any

from .config import EngineConfig
from .models import ComponentScores, FeatureSnapshot
from .utils import clamp, collapse_regime_label, sign


class RegimeClassifier:
    """Convert component scores into final labels, tags, and confidence."""

    def __init__(self, config: EngineConfig) -> None:
        self.config = config

    def classify(
        self,
        feature_snapshot: FeatureSnapshot,
        component_scores: ComponentScores,
    ) -> dict[str, Any]:
        """Return final regime metadata from scores and interpretable features."""

        return self.classify_values(
            features=feature_snapshot.values,
            component_scores=component_scores,
            coverage_ratio=feature_snapshot.coverage_ratio,
        )

    def classify_values(
        self,
        features: dict[str, Any],
        component_scores: ComponentScores,
        coverage_ratio: float,
    ) -> dict[str, Any]:
        """Return final regime metadata from plain feature mappings."""

        composite = component_scores.composite_trend_score
        direction = component_scores.trend_direction.score
        strength = component_scores.trend_strength.score
        momentum = component_scores.momentum.score
        transition = component_scores.transition_risk.score

        regime_label = self._classify_regime(
            composite=composite,
            direction=direction,
            strength=strength,
        )
        transition_label = self._classify_transition(transition)
        tags = self._build_tags(features, component_scores)
        agreement_score = self._agreement_score(features, component_scores)
        confidence_score = self._confidence_score(
            composite=composite,
            strength=strength,
            coverage_ratio=coverage_ratio,
            agreement_score=agreement_score,
            transition_score=transition,
        )
        bullish_score = clamp(max(composite, 0.0), 0.0, 100.0)
        bearish_score = clamp(max(-composite, 0.0), 0.0, 100.0)
        summary_text = self._summary_text(
            regime_label=regime_label,
            transition_label=transition_label,
            features=features,
            component_scores=component_scores,
            tags=tags,
        )
        trend_state_label = collapse_regime_label(regime_label)

        return {
            "regime_label": regime_label,
            "trend_state_label": trend_state_label,
            "transition_risk_label": transition_label,
            "bullish_score": bullish_score,
            "bearish_score": bearish_score,
            "confidence_score": confidence_score,
            "tags": tags,
            "summary_text": summary_text,
            "diagnostics": {
                "agreement_score": agreement_score,
                "coverage_ratio": coverage_ratio,
                "composite_trend_score": composite,
                "signed_strength": component_scores.signed_strength,
            },
        }

    def _classify_regime(self, composite: float, direction: float, strength: float) -> str:
        classifier_cfg = self.config.classifier
        if (
            composite >= classifier_cfg.strong_uptrend_threshold
            and direction >= classifier_cfg.strong_direction_threshold
            and strength >= classifier_cfg.strong_strength_threshold
        ):
            return "strong_uptrend"
        if (
            composite <= classifier_cfg.strong_downtrend_threshold
            and direction <= -classifier_cfg.strong_direction_threshold
            and strength >= classifier_cfg.strong_strength_threshold
        ):
            return "strong_downtrend"
        composite_is_neutral = (
            classifier_cfg.weak_downtrend_threshold < composite < classifier_cfg.weak_uptrend_threshold
        )
        strength_is_weak = strength < classifier_cfg.sideways_strength_max
        if classifier_cfg.sideways_requires_neutral_composite_and_low_strength:
            if composite_is_neutral and strength_is_weak:
                return "sideways"
        elif composite_is_neutral or strength_is_weak:
            return "sideways"
        if composite >= classifier_cfg.weak_uptrend_threshold:
            return "weak_uptrend"
        if composite <= classifier_cfg.weak_downtrend_threshold:
            return "weak_downtrend"
        return "sideways"

    def _classify_transition(self, transition_score: float) -> str:
        classifier_cfg = self.config.classifier
        if transition_score <= classifier_cfg.transition_low_max:
            return "low"
        if transition_score <= classifier_cfg.transition_moderate_max:
            return "moderate"
        return "high"

    def _agreement_score(self, features: dict[str, Any], component_scores: ComponentScores) -> float:
        direction_sign = sign(
            component_scores.trend_direction.score,
            neutral_threshold=self.config.classifier.composite_sign_neutral_threshold,
        )
        if direction_sign == 0:
            direction_sign = sign(
                component_scores.composite_trend_score,
                neutral_threshold=self.config.agreement.fallback_composite_neutral_threshold,
            )
        agreement_cfg = self.config.agreement
        signals = [
            sign(component_scores.momentum.score, neutral_threshold=agreement_cfg.score_signal_neutral_threshold),
            sign(component_scores.volume_confirmation.score, neutral_threshold=agreement_cfg.score_signal_neutral_threshold),
            sign(self._as_float(features.get("ema_alignment_state")), neutral_threshold=agreement_cfg.structure_signal_neutral_threshold),
            sign(self._as_float(features.get("donchian_breakout_context")), neutral_threshold=agreement_cfg.structure_signal_neutral_threshold),
        ]
        comparable = [value for value in signals if value != 0]
        if direction_sign == 0 or not comparable:
            return agreement_cfg.default_agreement_score
        aligned = sum(1 for value in comparable if value == direction_sign)
        return clamp((aligned / len(comparable)) * 100.0, 0.0, 100.0)

    def _confidence_score(
        self,
        composite: float,
        strength: float,
        coverage_ratio: float,
        agreement_score: float,
        transition_score: float,
    ) -> float:
        confidence_cfg = self.config.confidence
        base = (
            confidence_cfg.composite_abs_weight * abs(composite)
            + confidence_cfg.strength_weight * strength
            + confidence_cfg.coverage_weight * coverage_ratio * 100.0
            + confidence_cfg.agreement_weight * agreement_score
        )
        penalty = confidence_cfg.transition_penalty_weight * transition_score
        return clamp(base - penalty, 0.0, 100.0)

    def _build_tags(self, features: dict[str, Any], component_scores: ComponentScores) -> list[str]:
        tags: list[str] = []
        tag_cfg = self.config.tags
        direction = component_scores.trend_direction.score
        momentum = component_scores.momentum.score
        strength = component_scores.trend_strength.score
        transition = component_scores.transition_risk.score

        if transition >= tag_cfg.reversal_risk_rising_threshold:
            tags.append("reversal_risk_rising")
        if (
            self._as_float(features.get("squeeze_flag")) > 0
            and abs(direction) < tag_cfg.breakout_watch_direction_max
            and (
                abs(momentum) >= tag_cfg.breakout_watch_momentum_min
                or abs(direction) >= tag_cfg.breakout_watch_direction_min
                or abs(self._as_float(features.get("donchian_breakout_context"))) >= tag_cfg.breakout_watch_context_min
            )
        ):
            tags.append("breakout_watch")
        if (
            self._as_float(features.get("exhaustion_flag")) > 0
            or abs(self._as_float(features.get("overextension_ema20_atr"))) >= self.config.feature_thresholds.overextension_warn_atr
            and transition >= tag_cfg.exhaustion_transition_min
        ):
            tags.append("exhaustion_risk")
        if (
            abs(direction) >= tag_cfg.volume_unconfirmed_direction_min
            and abs(component_scores.volume_confirmation.score) < tag_cfg.volume_unconfirmed_volume_abs_max
        ):
            tags.append("volume_unconfirmed")
        if (
            sign(direction, neutral_threshold=tag_cfg.trend_accelerating_signal_neutral)
            == sign(momentum, neutral_threshold=tag_cfg.trend_accelerating_signal_neutral)
            != 0
            and strength >= tag_cfg.trend_accelerating_strength_min
            and self._as_float(features.get("adx_rollover")) == 0.0
            and sign(
                self._as_float(features.get("macd_hist_slope_3")),
                neutral_threshold=tag_cfg.trend_accelerating_macd_hist_neutral,
            )
            == sign(direction, neutral_threshold=tag_cfg.trend_accelerating_signal_neutral)
        ):
            tags.append("trend_accelerating")
        if (
            self._as_float(features.get("adx_rollover")) > 0
            or self._as_float(features.get("macd_momentum_fade")) > 0
            or abs(self._as_float(features.get("trend_persistence_20"))) < tag_cfg.trend_weakening_persistence_abs_max
        ):
            tags.append("trend_weakening")
        return tags

    def _summary_text(
        self,
        regime_label: str,
        transition_label: str,
        features: dict[str, Any],
        component_scores: ComponentScores,
        tags: list[str],
    ) -> str:
        summary_cfg = self.config.summary
        tag_cfg = self.config.tags
        regime_text = summary_cfg.regime_text.get(regime_label, regime_label.replace("_", " "))
        transition_text = summary_cfg.transition_text.get(transition_label, transition_label)

        momentum_score = component_scores.momentum.score
        if momentum_score >= tag_cfg.summary_momentum_positive_min:
            momentum_clause = "Momentum remains positive."
        elif momentum_score <= tag_cfg.summary_momentum_negative_max:
            momentum_clause = "Momentum remains negative."
        else:
            momentum_clause = "Momentum is mixed."

        secondary_clauses: list[str] = []
        if "trend_accelerating" in tags:
            secondary_clauses.append("Trend strength and directional momentum are improving.")
        if "volume_unconfirmed" in tags:
            secondary_clauses.append("Volume confirmation is weak.")
        if "exhaustion_risk" in tags:
            secondary_clauses.append("Short-term exhaustion risk is increasing.")
        if "breakout_watch" in tags:
            secondary_clauses.append("Compression suggests breakout potential is building.")
        if "trend_weakening" in tags and "trend_accelerating" not in tags:
            secondary_clauses.append("Some trend quality metrics are weakening.")

        if not secondary_clauses:
            if component_scores.trend_strength.score >= tag_cfg.summary_strength_healthy_min:
                secondary_clauses.append("Trend strength is healthy.")
            elif component_scores.trend_strength.score < tag_cfg.summary_strength_limited_max:
                secondary_clauses.append("Trend strength is limited.")

        first_sentence = f"Current regime is {regime_text} with {transition_text} transition risk."
        second_sentence = " ".join([momentum_clause, *secondary_clauses]).strip()
        return f"{first_sentence} {second_sentence}".strip()

    @staticmethod
    def _as_float(value: Any, default: float = 0.0) -> float:
        if value is None:
            return default
        return float(value)
