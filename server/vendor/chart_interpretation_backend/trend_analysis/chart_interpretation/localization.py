"""Localization helpers for report-friendly chart interpretation output."""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any


TERM_MAPS = {
    "trend_state": {
        "uptrend": "상승 추세",
        "downtrend": "하락 추세",
        "range": "박스권",
        "weak trend": "약한 추세",
        "transition": "전환 구간",
    },
    "market_structure": {
        "bullish structure intact": "상승 구조 유지",
        "bearish structure intact": "하락 구조 유지",
        "range structure": "박스 구조",
        "compression": "압축 구조",
        "structure weakening": "구조 약화",
        "break of structure": "구조 돌파",
        "change of character": "성격 변화",
        "transition": "전환 구간",
    },
    "location_state": {
        "near support": "지지 인접",
        "near resistance": "저항 인접",
        "mid-range": "중간 구간",
        "breakout zone": "돌파 구간",
        "retest zone": "리테스트 구간",
        "overextended zone": "과열 구간",
    },
    "confidence_label": {
        "low conviction": "낮은 확신",
        "moderate conviction": "보통 확신",
        "strong conviction": "강한 확신",
    },
    "direction": {
        "bullish": "상방",
        "bearish": "하방",
        "neutral": "중립",
    },
    "scenario_name": {
        "bullish continuation after pullback": "눌림 이후 상승 재개",
        "breakout in progress": "돌파 진행",
        "breakout likely to fail": "돌파 실패 가능성",
        "bearish continuation": "하락 지속",
        "reversal candidate": "반전 후보",
        "range mean reversion": "박스 평균회귀",
    },
    "pattern_name": {
        "bull flag": "불 플래그",
        "bear flag": "베어 플래그",
        "symmetrical triangle": "대칭 삼각형",
        "ascending triangle": "상승 삼각형",
        "descending triangle": "하락 삼각형",
        "rising wedge": "상승 웨지",
        "falling wedge": "하락 웨지",
        "range box": "박스권",
        "range breakout": "박스 돌파",
        "breakout retest": "돌파 후 리테스트",
        "trend pullback continuation": "추세 눌림목 지속",
        "double top": "더블탑",
        "double bottom": "더블바텀",
        "volatility contraction breakout": "변동성 수축 돌파",
        "failed breakout": "실패한 돌파",
        "bullish engulfing": "상승 장악형",
        "bearish engulfing": "하락 장악형",
        "pin bar": "핀바",
        "inside bar": "인사이드 바",
        "breakout candle": "돌파 캔들",
        "exhaustion candle": "소진 캔들",
    },
    "event_type": {
        "breakout above prior swing high": "이전 스윙 고점 돌파",
        "breakout below prior swing low": "이전 스윙 저점 이탈",
        "structure break": "구조 돌파",
        "volatility compression": "변동성 압축",
        "volume-confirmed breakout": "거래량 확인 돌파",
        "rejection from resistance zone": "저항대 반락",
    },
}


EXACT_TEXT_MAP = {
    "Current close is above the latest major swing high.": "현재 종가는 최근 주요 스윙 고점 위에 있습니다.",
    "Current close is below the latest major swing low.": "현재 종가는 최근 주요 스윙 저점 아래에 있습니다.",
    "Recent swing amplitude has contracted.": "최근 스윙 폭이 줄어들었습니다.",
    "Breakout bar quality and relative volume are both strong.": "돌파 캔들 품질과 상대 거래량이 모두 양호합니다.",
    "Upper wick indicates overhead rejection.": "윗꼬리가 위쪽 매물 저항을 보여줍니다.",
    "The bigger picture is mixed, so the recent daily structure is doing more of the analytical work here.": "상위 흐름이 엇갈려 있어 최근 일봉 구조가 해석의 중심이 됩니다.",
    "The daily chart is still trapped between range conditions and transition.": "일봉은 아직 박스권과 전환 구간 사이에 머물러 있습니다.",
    "Price is sitting near support, so this zone matters if buyers want the chart to stay constructive.": "가격이 지지 부근에 있어, 흐름이 살아 있으려면 이 구간을 지켜야 합니다.",
    "Price is pressing into resistance, so acceptance above this area still needs to be earned.": "가격이 저항을 밀어붙이는 자리라, 이 구간 위 안착이 아직 필요합니다.",
    "Price is testing a prior breakout area, which is often where continuation either proves itself or fails.": "가격이 이전 돌파 구간을 다시 시험하는 중이라, 여기서 추세 지속 여부가 갈립니다.",
    "Price is trying to leave a prior balance area, so follow-through is more important than the first push.": "가격이 이전 균형 구간을 벗어나려는 중이라, 첫 돌파보다 후속 추종이 더 중요합니다.",
    "Price is stretched away from nearby support, so chasing strength here carries more risk.": "가격이 주변 지지에서 이미 멀어져 있어, 여기서 추격 매수는 부담이 큽니다.",
    "Price is still trading inside the middle of the current structure rather than at a clean decision level.": "가격은 아직 명확한 결론 구간보다 현재 구조의 중간에서 움직이고 있습니다.",
    "Price is coiling into a decision point, so a directional move may not be far away.": "가격이 결정을 앞둔 압축 구간으로 모이고 있어 방향성이 곧 나올 수 있습니다.",
    "The recent pullback still looks more like a bull flag than a larger breakdown.": "최근 눌림은 큰 하락 전환보다는 불 플래그에 더 가깝습니다.",
    "The bounce still looks more like a bear flag than a durable reversal.": "최근 반등은 추세 반전보다는 베어 플래그에 더 가깝습니다.",
    "The chart has built a double-top style ceiling, so the neckline matters.": "차트가 더블탑 형태의 천장을 만든 만큼 넥라인이 중요합니다.",
    "The chart is trying to base through a double-bottom structure, so the neckline remains the trigger.": "차트가 더블바텀 구조로 바닥을 다지는 중이라 넥라인이 핵심 트리거입니다.",
    "The chart is tightening into a symmetrical triangle, which usually resolves with expansion.": "차트가 대칭 삼각형으로 수렴 중이라 이후 변동성 확장이 중요합니다.",
    "The chart is leaning against resistance while lows continue to rise underneath.": "저항을 누르면서도 저점은 계속 높아지고 있습니다.",
    "The chart is leaning on support while rally attempts keep losing height.": "지지를 누르는 가운데 반등 고점은 점점 낮아지고 있습니다.",
    "Current location matters because price is testing nearby support.": "현재 위치가 중요한 이유는 가격이 바로 아래 지지를 시험하고 있기 때문입니다.",
    "Current location matters because price is pressing into nearby resistance.": "현재 위치가 중요한 이유는 가격이 바로 위 저항을 시험하고 있기 때문입니다.",
    "Current location matters because the retest area still has to hold.": "현재 위치가 중요한 이유는 리테스트 구간이 아직 유지돼야 하기 때문입니다.",
    "Current location matters because the breakout area still needs acceptance.": "현재 위치가 중요한 이유는 돌파 구간 위 안착이 아직 확인돼야 하기 때문입니다.",
    "That view has some help from the larger timeframe trend.": "이 해석은 상위 타임프레임 흐름의 도움도 받고 있습니다.",
    "The larger timeframe does not fully agree yet, so follow-through still matters.": "다만 상위 타임프레임이 아직 완전히 동의하지 않아 후속 추종이 필요합니다.",
    "Momentum is stabilizing rather than strongly stretched.": "모멘텀은 과열보다는 안정화 쪽에 가깝습니다.",
    "That would gain weight if the current structure loses its last nearby support or resistance reference.": "현재 구조가 마지막 지지 또는 저항 기준을 잃으면 이 대안 시나리오의 무게가 커집니다.",
    "A genuine change of character would make the alternative scenario more credible.": "실제 성격 변화가 확인되면 대안 시나리오의 신뢰도도 높아집니다.",
    "This area is important because failed reactions from the current zone would shift the read quickly.": "이 구간 반응이 실패하면 해석이 빠르게 바뀔 수 있어 지금 자리가 중요합니다.",
    "The higher timeframe backdrop should still be respected before treating it as more than a corrective move.": "이를 단순 조정을 넘는 흐름으로 보려면 상위 타임프레임 배경도 함께 확인해야 합니다.",
    "There is no strong competing scenario yet, so the chart mainly hinges on whether the current structure holds.": "아직 뚜렷한 경쟁 시나리오는 없어, 결국 현재 구조가 유지되는지가 핵심입니다.",
    "Higher timeframe bias still leans the other way.": "상위 타임프레임 방향은 아직 반대편에 기울어 있습니다.",
    "Compression can break sharply in either direction.": "압축 구간은 어느 방향으로든 강하게 이탈할 수 있습니다.",
    "Price is already stretched from nearby value.": "가격이 이미 근처 가치 구간에서 멀어져 있습니다.",
    "Scenario ranking is still fairly tight.": "시나리오 간 우열 차이가 아직 크지 않습니다.",
    "Conviction stays low until the next structure break is confirmed.": "다음 구조 돌파가 확인되기 전까지는 확신이 낮습니다.",
    "The lead pattern is starting to lose freshness.": "선행 패턴의 신선도가 조금씩 떨어지고 있습니다.",
    "Hold above the nearest support zone": "가장 가까운 지지 구간 위를 유지하는지",
    "See stable or improving relative volume": "상대 거래량이 안정적이거나 개선되는지",
    "Overhead resistance remains close": "바로 위 저항이 가깝습니다.",
    "A close that stays above the breakout zone": "종가가 돌파 구간 위에서 유지되는지",
    "Follow-through volume on the next bars": "다음 캔들에서 거래량 추종이 붙는지",
    "Fresh breakout can still retest": "새 돌파는 다시 리테스트가 나올 수 있습니다.",
    "A close back inside the prior range": "종가가 이전 박스 안으로 다시 들어오는지",
    "Follow-through selling below the failed breakout bar": "실패한 돌파 캔들 아래로 매도 추종이 나오는지",
    "Failure setup is weaker if higher timeframe trend stays bullish": "상위 타임프레임이 강세면 실패 시나리오 신뢰도는 낮아집니다.",
    "Stay below the nearest resistance zone": "가장 가까운 저항 아래에 머무는지",
    "Keep seeing weak rebound quality": "반등의 질이 계속 약한지",
    "Support beneath price can slow the move": "아래 지지가 하락 속도를 늦출 수 있습니다.",
    "A confirmed break of the nearest structure pivot": "가장 가까운 구조 피벗을 확실히 돌파하는지",
    "Better follow-through volume": "후속 거래량이 더 붙는지",
    "Counter-trend reversal setups need stronger confirmation": "역추세 반전은 더 강한 확인이 필요합니다.",
    "Price needs to stay inside the range": "가격이 박스 안에 계속 머무는지",
    "No decisive breakout should appear": "결정적인 이탈이 나오지 않는지",
    "Mean reversion loses validity quickly once range boundaries break": "박스 경계가 깨지면 평균회귀 해석은 빠르게 무효가 됩니다.",
    "Price structure still leans constructive.": "가격 구조는 아직 긍정적으로 기울어 있습니다.",
    "Price is near a support or retest area rather than extended from it.": "가격은 멀리 이격된 위치보다 지지 또는 리테스트 구간에 더 가깝습니다.",
    "Price is attempting to leave the prior range or compression zone.": "가격은 이전 박스나 압축 구간을 벗어나려 하고 있습니다.",
    "Indicator confirmation is supportive but secondary to the price break.": "보조지표 확인은 우호적이지만, 핵심은 가격 돌파 자체입니다.",
    "Upper-wick rejection and weak acceptance above resistance make the breakout vulnerable.": "윗꼬리 반락과 약한 안착 흐름 때문에 이번 돌파는 아직 불안합니다.",
    "This is a scenario path, not a guaranteed reversal.": "이건 하나의 시나리오 경로일 뿐, 확정된 반전은 아닙니다.",
    "Structure remains vulnerable and price is not reclaiming resistance decisively.": "구조는 여전히 취약하고 가격도 저항을 확실히 되찾지 못하고 있습니다.",
    "Continuation is favored only if lower highs keep forming.": "더 낮은 고점이 계속 형성될 때만 추세 지속 해석이 유효합니다.",
    "A possible reversal signature is forming, but it is not yet dominant.": "반전 시그널 가능성은 생기고 있지만 아직 주도적이지는 않습니다.",
    "Counter-trend setups should be treated as scenario candidates, not forecasts.": "역추세 셋업은 확정 예측이 아니라 후보 시나리오로 다뤄야 합니다.",
    "The market is behaving more like a range than a directional trend.": "시장은 방향 추세보다 박스권에 더 가깝게 움직이고 있습니다.",
    "Location inside the box matters more than indicator momentum here.": "이 구간에서는 지표 모멘텀보다 박스 안 위치가 더 중요합니다.",
    "The prior impulse is still intact and the pullback has stayed controlled.": "이전 상승 추진은 아직 살아 있고, 눌림도 통제된 범위에 머물렀습니다.",
    "Recent highs and lows are drifting lower in a contained channel rather than breaking trend support outright.": "최근 고점과 저점이 완만한 하락 채널을 만들고 있을 뿐, 추세 지지를 완전히 무너뜨리진 않았습니다.",
    "The rebound has stayed contained and still looks corrective inside the larger decline.": "반등은 제한된 범위에 머물고 있어 큰 하락 흐름 안의 되돌림에 가깝습니다.",
    "Recent highs and lows are lifting together, but the move has not repaired the broader downtrend.": "최근 고점과 저점이 함께 올라가고 있지만, 큰 하락 추세를 되돌릴 정도는 아닙니다.",
    "The chart is narrowing into a tighter swing structure.": "차트가 더 좁은 스윙 구조로 수렴하고 있습니다.",
    "A clean break from these converging boundaries would matter more than the indicators on their own.": "이 수렴 경계의 명확한 이탈이 지표 자체보다 더 중요합니다.",
    "Price is still trading like a box rather than a clean directional trend.": "가격은 아직 뚜렷한 추세보다 박스 형태에 가깝게 움직이고 있습니다.",
    "The range boundaries matter more than indicator drift while the market stays inside them.": "시장 가격이 박스 안에 있는 동안에는 지표 움직임보다 박스 경계가 더 중요합니다.",
    "Price has pushed through the recent box ceiling.": "가격이 최근 박스 상단을 넘어섰습니다.",
    "The move looks more credible because the close is holding above the prior range high.": "종가가 이전 박스 상단 위에서 버티고 있어 이번 움직임의 신뢰도가 더 높습니다.",
    "Price is revisiting a prior break area instead of running straight away from it.": "가격이 곧장 멀어지기보다 이전 돌파 구간을 다시 확인하고 있습니다.",
    "This is the kind of test that often decides whether the move was real or premature.": "이런 재시험은 돌파가 진짜였는지 성급했는지를 가르는 자리입니다.",
    "The move still looks more like a pullback into trend support than a full trend reversal.": "이번 움직임은 추세 지지로의 눌림에 더 가깝고, 추세 반전으로 보이진 않습니다.",
    "Price is working around the fast average and recent pullback boundaries instead of collapsing through them.": "가격은 단기 이평과 최근 눌림 경계 위에서 버티고 있으며, 바로 무너지는 모습은 아닙니다.",
    "The chart has failed to sustain a second push through the prior high area.": "차트는 이전 고점 부근에서 두 번째 상승 시도를 유지하지 못했습니다.",
    "Now the neckline is the key level separating a topping pattern from a messy consolidation.": "이제 넥라인이 천장형 패턴과 단순 횡보를 가르는 핵심 레벨입니다.",
    "The chart has tested the same low area twice and recovered the neckline in between.": "차트는 같은 저점대를 두 번 확인했고 그 사이 넥라인도 회복했습니다.",
    "That leaves the neckline as the level buyers still need to defend.": "결국 넥라인이 매수세가 지켜야 할 핵심 레벨로 남습니다.",
    "The swing amplitude has been tightening before the latest push higher.": "최근 상승 직전까지 스윙 폭이 점점 줄어들고 있었습니다.",
    "That kind of contraction tends to matter most when the breakout also arrives with better participation.": "이런 수축은 거래 참여가 동반된 돌파가 나올 때 가장 의미가 커집니다.",
    "Price briefly traded above resistance but could not hold the break into the close.": "가격이 잠시 저항 위로 올라섰지만 종가 기준으로는 돌파를 지키지 못했습니다.",
    "That kind of rejection often turns into a trap if follow-through selling appears next.": "이런 반락은 이후 매도 추종이 붙으면 함정 돌파로 이어지기 쉽습니다.",
    "Price briefly traded below support but recovered back through the level by the close.": "가격이 잠시 지지 아래로 내려갔지만 종가에는 다시 회복했습니다.",
    "That kind of downside rejection often forces a squeeze if buyers follow through.": "이런 하단 거부는 이후 매수 추종이 붙으면 숏 스퀴즈로 이어질 수 있습니다.",
    "The market is still respecting a range box, so the edges matter more than the middle.": "시장은 아직 박스권 경계를 존중하고 있어, 중앙보다 상단과 하단이 더 중요합니다.",
    "The current pullback still looks more like a retest than a failed move so far.": "현재 눌림은 아직 실패한 움직임보다 리테스트에 더 가깝습니다.",
    "Price is pulling back toward the 20 EMA while holding above support, which still looks more like a controlled retracement.": "가격이 지지 위에서 20 EMA 쪽으로 눌리고 있어, 아직은 무너짐보다 통제된 되돌림에 가깝습니다.",
    "Price has slipped below the 50 EMA, so the recent structure has clearly weakened.": "가격이 50 EMA 아래로 밀리면서 최근 구조가 분명히 약해졌습니다.",
    "Price remains above the 200 EMA, so the larger directional bias is still constructive.": "가격이 여전히 200 EMA 위에 있어 큰 방향성은 아직 우호적입니다.",
    "Price remains below the 200 EMA, so the larger directional bias is still heavy.": "가격이 여전히 200 EMA 아래에 있어 큰 방향성은 아직 무겁습니다.",
    "Price is trading around the cloud, which fits a less decisive trend regime.": "가격이 구름대 주변에서 움직이고 있어, 지금은 방향성이 덜 분명한 국면에 가깝습니다.",
    "Price is back above the cloud, but buyers still need to turn that into support.": "가격이 다시 구름대 위로 올라왔지만, 이 구간을 지지로 바꾸는 확인이 아직 필요합니다.",
    "Price is still below the cloud, so rebounds can run into overhead supply.": "가격이 아직 구름대 아래에 있어 반등이 나오더라도 위쪽 매물에 막힐 수 있습니다.",
    "The latest candle printed a bullish engulfing pattern at an important area.": "최근 캔들은 중요한 자리에서 상승 장악형을 만들었습니다.",
    "The latest candle printed a bearish engulfing pattern near resistance.": "최근 캔들은 저항 부근에서 하락 장악형을 만들었습니다.",
    "The latest candle rejected lower prices, which matters if support is going to hold.": "최근 캔들은 아래 가격을 강하게 거부했고, 지지가 유지되려면 이런 반응이 중요합니다.",
    "The latest candle rejected higher prices, so buyers still have overhead supply to clear.": "최근 캔들은 위 가격을 거부했고, 매수세는 아직 위쪽 매물을 넘어야 합니다.",
    "The latest candle is an inside bar, so the market is still compressing near the decision area.": "최근 캔들은 인사이드 바로 끝나 현재 시장은 결정을 앞둔 자리에서 계속 압축되고 있습니다.",
    "The latest candle expanded to the upside, but the breakout still needs follow-through.": "최근 캔들은 위로 확장됐지만, 돌파가 유효하려면 후속 추종이 더 필요합니다.",
    "The latest candle expanded to the downside, and that keeps pressure on nearby support.": "최근 캔들은 아래로 확장됐고, 그 때문에 근처 지지에는 계속 압력이 남아 있습니다.",
    "The latest candle shows upside exhaustion, which can matter if resistance holds.": "최근 캔들은 위쪽 소진 신호를 보여주고 있어 저항이 유지되면 의미가 커질 수 있습니다.",
    "The latest candle rejected the downside sharply, which can matter if support holds.": "최근 캔들은 아래쪽을 강하게 거부했고, 지지가 유지되면 이 반응이 중요해질 수 있습니다.",
    "The latest candle behavior matters because price is already sitting at a nearby decision zone.": "가격이 이미 근처 핵심 구간에 있어 최근 캔들 반응이 특히 중요합니다.",
    "Price is pulling back into the 20 EMA rather than losing the broader support structure.": "가격은 넓은 지지 구조를 잃기보다 20 EMA 쪽으로 눌리는 모습에 가깝습니다.",
    "Price is still above the 200 EMA, so the larger bias remains supportive.": "가격이 아직 200 EMA 위에 있어 큰 흐름은 여전히 우호적입니다.",
    "Price has lost the 50 EMA, which fits a weaker short-term structure.": "가격이 50 EMA를 잃은 만큼 단기 구조 약화와 더 잘 맞습니다.",
    "Price remains below the 200 EMA, so the larger bias still leans lower.": "가격이 여전히 200 EMA 아래에 있어 큰 흐름은 아직 하방 쪽입니다.",
    "Price is holding above the cloud, which supports the idea of support sitting underneath the move.": "가격이 구름대 위를 지키고 있어 아래 지지가 살아 있다는 해석을 뒷받침합니다.",
    "Price is staying below the cloud, so rebounds still look vulnerable.": "가격이 구름대 아래에 머무르고 있어 반등도 여전히 취약해 보입니다.",
    "Price is still in the cloud, so trend conviction should stay measured.": "가격이 아직 구름대 안에 있어 추세 확신은 보수적으로 가져가야 합니다.",
    "The latest candle behavior supports the bullish case, but only if buyers get follow-through.": "최근 캔들 반응은 상방 시나리오를 지지하지만, 매수 추종이 붙을 때만 의미가 커집니다.",
    "The latest candle behavior supports the bearish case, but only if sellers press the next swing.": "최근 캔들 반응은 하방 시나리오를 지지하지만, 다음 스윙에서 매도 압력이 이어질 때만 의미가 커집니다.",
    "This still looks more like a correction than a confirmed reversal unless support breaks.": "지지가 깨지지 않는 한, 지금 움직임은 확정 반전보다 조정에 더 가깝습니다.",
    "If price starts losing the recent higher-low structure, the bullish read would weaken quickly.": "가격이 최근 higher low 구조를 잃기 시작하면 상방 해석은 빠르게 약해질 수 있습니다.",
    "If price reclaims the last breakdown area cleanly, the bearish read would lose traction.": "가격이 마지막 하락 이탈 구간을 깔끔하게 되찾으면 하방 해석은 힘을 잃게 됩니다.",
    "Hold the 20 EMA area on pullbacks": "눌림이 나와도 20 EMA 구간을 지키는지",
    "Stay above the 50 EMA while the larger trend stays constructive": "큰 흐름이 살아 있는 동안 50 EMA 위를 유지하는지",
    "Watch whether price gains acceptance above the cloud": "가격이 구름대 위에서 안착하는지",
    "Let the latest bullish candle get follow-through": "최근 강세 캔들에 후속 추종이 붙는지",
    "Keep price below the 50 EMA on rebounds": "반등이 나와도 50 EMA 아래에 머무는지",
    "Watch whether price loses the cloud support area": "가격이 구름대 지지 구간을 잃는지",
    "Do not let the latest bearish rejection get reclaimed": "최근 약세 반락 캔들을 다시 되돌리지 않는지",
    "The latest bar has engulfed the prior bearish body.": "최근 캔들이 이전 음봉 몸통을 완전히 감쌌습니다.",
    "The latest bar has engulfed the prior bullish body.": "최근 캔들이 이전 양봉 몸통을 완전히 감쌌습니다.",
    "The candle rejected lower prices with a long lower wick.": "긴 아래꼬리로 낮은 가격대를 강하게 거부했습니다.",
    "The candle rejected higher prices with a long upper wick.": "긴 위꼬리로 높은 가격대를 강하게 거부했습니다.",
    "The latest bar is contained inside the prior bar and reflects short-term compression.": "최근 캔들이 이전 캔들 안에 갇혀 있어 단기 압축을 보여줍니다.",
    "The latest candle expanded its range and closed near the high.": "최근 캔들이 범위를 확장한 뒤 고가 부근에서 마감했습니다.",
    "The latest candle expanded its range and closed near the low.": "최근 캔들이 범위를 확장한 뒤 저가 부근에서 마감했습니다.",
    "The range expanded, but the upper wick shows fading upside acceptance.": "범위는 커졌지만 위꼬리가 길어 상승 안착 힘이 약해졌습니다.",
    "The range expanded, but the lower wick shows downside rejection.": "범위는 커졌지만 아래꼬리가 길어 하단 거부가 나타났습니다.",
    "It looks more like a shonen reset scene, where the hero takes one step back before charging again.": "이건 소년만화에서 주인공이 한 걸음 물러서 기를 모은 뒤 다시 돌진하는 장면에 더 가깝습니다.",
    "It looks more like the villain's brief comeback montage than a true turn in the story.": "이건 이야기 흐름이 바뀌었다기보다 악역이 잠깐 반격하는 몽타주에 더 가깝습니다.",
    "The chart feels like a thriller hallway scene: quiet for a while, and then suddenly not quiet.": "차트는 스릴러 영화 복도 장면 같습니다. 한동안 조용하다가 갑자기 조용하지 않아지는 자리입니다.",
    "This part looks like a heist movie checkpoint, where clearing the door matters less than holding the exit.": "이 구간은 하이스트 영화의 체크포인트 같습니다. 문을 여는 것보다 출구를 지켜내는 게 더 중요합니다.",
    "Right now it feels more like a boxing movie feeling-out round than a finishing punch.": "지금은 결정타를 날리는 장면보다 복싱 영화에서 서로 탐색전만 하는 라운드에 더 가깝습니다.",
    "This still reads like a plot-twist setup, not the final scene.": "이건 아직 결말 장면이 아니라 반전 복선을 까는 단계에 더 가깝습니다.",
    "It is a bit like an escape movie: getting over the wall is one thing, staying out is the real test.": "탈출 영화로 치면 담을 넘는 것과 밖에서 버티는 것은 다른 문제입니다. 지금은 후자가 더 중요합니다.",
    "It looks more like the hero regrouping between fights than the story changing sides.": "이건 이야기의 진영이 바뀌었다기보다 주인공이 다음 싸움 전에 재정비하는 장면에 더 가깝습니다.",
    "It feels more like the second act pressure scene, where each rebound gets pushed back down.": "이건 2막 압박 장면처럼 보입니다. 반등이 나와도 다시 눌리는 흐름 쪽에 가깝습니다.",
    "For now it looks more like a possible plot twist than the final reveal.": "지금은 최종 반전 확정보다 반전 가능성을 슬쩍 보여주는 단계에 더 가깝습니다.",
    "The tape has the feel of an anime power-up pause, where not much happens until everything happens at once.": "이 흐름은 애니메이션에서 힘을 모으는 정적 구간 같습니다. 한동안 별일 없다가 한 번에 크게 움직일 수 있습니다.",
    "This area has the feel of the movie standoff before the first real move.": "이 자리는 영화에서 첫 실제 행동이 나오기 전의 대치 장면 같은 자리입니다.",
    "Support is doing its job for now, and the 'for now' part matters.": "지지는 지금까진 자기 일을 하고 있습니다. 다만 '지금까진'이 중요합니다.",
    "Resistance is still close, and looking strong is not the same thing as getting through.": "저항이 아직 가깝고, 강해 보이는 것과 실제로 넘기는 것은 다른 문제입니다.",
    "The first break is not the point; holding above it is.": "첫 돌파 자체가 핵심은 아니고, 그 위에서 버티는지가 핵심입니다.",
    "Retests are where good stories survive and bad ones end early.": "리테스트는 좋은 이야기와 나쁜 이야기가 갈리는 자리입니다.",
    "Quiet tape usually stays quiet until it doesn't.": "조용한 차트는 대개 끝까지 조용하진 않습니다.",
    "It looks weaker, yes, but confirmed reversal is another matter.": "약해진 건 맞습니다. 다만 확인된 반전이라고 보기엔 아직 이릅니다.",
    "Inside a box, dramatic narratives usually waste everyone's time.": "박스 안에서는 지나친 서사가 대개 시간만 잡아먹습니다.",
    "The move is fine so far, but staying above the break is the actual exam.": "움직임 자체는 지금까진 괜찮습니다. 다만 돌파 위에서 버티는지가 진짜 시험입니다.",
    "So far this still looks like a reset rather than a script change.": "지금까진 대본이 바뀌었다기보다 흐름이 잠깐 리셋되는 쪽에 더 가깝습니다.",
    "Bounces can happen inside a down move, but keeping the rebound is the harder ask.": "하락 흐름 안에서도 반등은 나옵니다. 다만 그 반등을 지켜내는 쪽이 더 어렵습니다.",
    "Possible turn, yes, but confirmed turn is another matter.": "방향이 바뀔 가능성은 있습니다. 다만 확인된 전환은 또 다른 문제입니다.",
    "Failed moves often look fine for a moment, and then they don't.": "실패하는 움직임도 잠깐은 멀쩡해 보입니다. 그러다 갑자기 안 멀쩡해집니다.",
    "This can still work higher. It just has to earn it here.": "여기서 더 올라갈 수도 있습니다. 다만 지금 이 자리에서 그 자격을 보여줘야 합니다.",
    "This can still hold. Losing this area would change the tone quickly.": "이 자리는 아직 버틸 수 있습니다. 다만 이 구간을 잃으면 톤이 빠르게 바뀝니다.",
    "Retests look clean right up until they fail, so this level matters.": "리테스트는 실패하기 전까지는 늘 깔끔해 보입니다. 그래서 이 레벨이 중요합니다.",
    "Compressed charts can look calm right before they stop being calm.": "압축된 차트는 안 조용해지기 직전까지는 늘 조용해 보일 수 있습니다.",
}


def build_report_locales(payload: dict[str, Any]) -> dict[str, Any]:
    """Build localized payload fragments used by the UI and exported report."""

    return {
        "default": "ko",
        "en": _extract_locale_payload(payload, "en"),
        "ko": _extract_locale_payload(payload, "ko"),
    }


def _extract_locale_payload(payload: dict[str, Any], language: str) -> dict[str, Any]:
    if language == "en":
        return {
            "summary_text": payload.get("summary_text"),
            "trend_state": payload.get("trend_state"),
            "market_structure": payload.get("market_structure"),
            "location_state": payload.get("location_state"),
            "confidence_label": payload.get("confidence_label"),
            "primary_scenario_explanation": payload.get("primary_scenario_explanation"),
            "alternative_scenario_explanation": payload.get("alternative_scenario_explanation"),
            "confirmation_checklist": deepcopy(payload.get("confirmation_checklist") or payload.get("confirmation_needed") or []),
            "risk_notes": deepcopy(payload.get("risk_notes") or payload.get("risk_flags") or []),
            "primary_scenario": deepcopy(payload.get("primary_scenario")),
            "strongest_alternative": deepcopy(payload.get("strongest_alternative")),
            "active_patterns": deepcopy(payload.get("active_patterns") or []),
            "recent_events": deepcopy(payload.get("recent_events") or []),
        }

    return {
        "summary_text": _translate_text(payload.get("summary_text", "")),
        "trend_state": TERM_MAPS["trend_state"].get(payload.get("trend_state", ""), payload.get("trend_state", "")),
        "market_structure": TERM_MAPS["market_structure"].get(payload.get("market_structure", ""), payload.get("market_structure", "")),
        "location_state": TERM_MAPS["location_state"].get(payload.get("location_state", ""), payload.get("location_state", "")),
        "confidence_label": TERM_MAPS["confidence_label"].get(payload.get("confidence_label", ""), payload.get("confidence_label", "")),
        "primary_scenario_explanation": _translate_text(payload.get("primary_scenario_explanation", "")),
        "alternative_scenario_explanation": _translate_text(payload.get("alternative_scenario_explanation", "")),
        "confirmation_checklist": [_translate_text(item) for item in (payload.get("confirmation_checklist") or payload.get("confirmation_needed") or [])],
        "risk_notes": [_translate_text(item) for item in (payload.get("risk_notes") or payload.get("risk_flags") or [])],
        "primary_scenario": _translate_scenario(payload.get("primary_scenario")),
        "strongest_alternative": _translate_scenario(payload.get("strongest_alternative")),
        "active_patterns": [_translate_pattern(item) for item in (payload.get("active_patterns") or [])],
        "recent_events": [_translate_event(item) for item in (payload.get("recent_events") or [])],
    }


def _translate_scenario(scenario: dict[str, Any] | None) -> dict[str, Any] | None:
    if scenario is None:
        return None
    translated = deepcopy(scenario)
    translated["name"] = TERM_MAPS["scenario_name"].get(translated.get("name", ""), translated.get("name", ""))
    translated["direction"] = TERM_MAPS["direction"].get(translated.get("direction", ""), translated.get("direction", ""))
    translated["confirmation_needed"] = [_translate_text(item) for item in translated.get("confirmation_needed", [])]
    translated["risk_flags"] = [_translate_text(item) for item in translated.get("risk_flags", [])]
    translated["explanation"] = [_translate_text(item) for item in translated.get("explanation", [])]
    return translated


def _translate_pattern(pattern: dict[str, Any]) -> dict[str, Any]:
    translated = deepcopy(pattern)
    translated["pattern_name"] = TERM_MAPS["pattern_name"].get(translated.get("pattern_name", ""), translated.get("pattern_name", ""))
    translated["direction"] = TERM_MAPS["direction"].get(translated.get("direction", ""), translated.get("direction", ""))
    translated["explanation"] = [_translate_text(item) for item in translated.get("explanation", [])]
    return translated


def _translate_event(event: dict[str, Any]) -> dict[str, Any]:
    translated = deepcopy(event)
    translated["event_type"] = TERM_MAPS["event_type"].get(translated.get("event_type", ""), TERM_MAPS["pattern_name"].get(translated.get("event_type", ""), translated.get("event_type", "")))
    translated["details"] = _translate_text(translated.get("details", ""))
    return translated


def _translate_text(text: str) -> str:
    if not text:
        return text
    if text in EXACT_TEXT_MAP:
        return EXACT_TEXT_MAP[text]
    if ". " in text or "; " in text:
        parts = re.split(r"(?<=[\.;])\s+", text)
        if len(parts) > 1:
            return " ".join(_translate_text(part.strip()) for part in parts if part.strip())

    patterns: list[tuple[str, Any]] = [
        (
            r"^The broader backdrop still leans (bullish|bearish), and the daily chart is mostly trading in the same direction\.$",
            lambda m: f"더 큰 흐름은 여전히 {_map_bias(m.group(1))} 쪽이고, 일봉도 대체로 그 방향을 따라가고 있습니다.",
        ),
        (
            r"^The higher timeframe trend still leans (bullish|bearish), but the recent daily structure has turned more (.+)\.$",
            lambda m: f"상위 타임프레임 추세는 아직 {_map_bias(m.group(1))} 쪽이지만, 최근 일봉 구조는 더 {_map_tone(m.group(2))} 쪽으로 기울었습니다.",
        ),
        (
            r"^The daily chart still leans (bullish|bearish), although the recent structure needs more confirmation\.$",
            lambda m: f"일봉은 아직 {_map_bias(m.group(1))} 쪽이지만, 최근 구조는 추가 확인이 더 필요합니다.",
        ),
        (
            r"^Momentum is (still leaning higher|still leaning lower|has stabilized), (.+)\.$",
            lambda m: f"{_map_momentum_lead(m.group(1))}, {_map_momentum_tail(m.group(2))}.",
        ),
        (
            r"^The favored path is (.+) with (.+)\.$",
            lambda m: f"우선 시나리오는 {_map_named(m.group(1), 'scenario_name')}이며, 확신도는 {TERM_MAPS['confidence_label'].get(m.group(2), m.group(2))}입니다.",
        ),
        (
            r"^Price structure still looks more like (.+) than a full reversal\.$",
            lambda m: f"가격 구조는 아직 완전한 반전보다는 {_map_tone(m.group(1))}에 더 가깝습니다.",
        ),
        (
            r"^The active setup still looks closest to a (.+)\.$",
            lambda m: f"현재 활성 셋업은 여전히 {_map_named(m.group(1), 'pattern_name')}에 가장 가깝습니다.",
        ),
        (
            r"^The main alternative is (.+)\.$",
            lambda m: f"가장 강한 대안 시나리오는 {_map_named(m.group(1), 'scenario_name')}입니다.",
        ),
        (
            r"^Respect the breakout reference near ([\\d,]+\\.\\d+)$",
            lambda m: f"대략 {m.group(1)} 부근 돌파 기준을 지키는지 확인",
        ),
        (
            r"^Avoid losing ([\\d,]+\\.\\d+) on a closing basis$",
            lambda m: f"종가 기준으로 {m.group(1)} 아래로 밀리지 않는지 확인",
        ),
        (
            r"^(bullish|bearish) break of structure is active\.$",
            lambda m: f"{_map_bias(m.group(1))} 구조 돌파가 현재 유효합니다.",
        ),
    ]
    for pattern, replacer in patterns:
        match = re.match(pattern, text)
        if match:
            return replacer(match)
    return text


def _map_bias(value: str) -> str:
    mapping = {"bullish": "상방", "bearish": "하방", "neutral": "중립"}
    return mapping.get(value, value)


def _map_named(value: str, category: str) -> str:
    return TERM_MAPS[category].get(value, value)


def _map_tone(value: str) -> str:
    mapping = {
        "constructive continuation": "상승 지속 구조",
        "downward continuation": "하락 지속 구조",
        "a range-bound market": "박스권 구조",
        "a tightening range": "수렴 압축 구조",
        "a correction": "조정 구조",
        "a fresh expansion": "새로운 확장 국면",
        "a possible reversal": "반전 가능성",
        "mixed": "혼조 흐름",
    }
    return mapping.get(value, value)


def _map_momentum_lead(value: str) -> str:
    mapping = {
        "still leaning higher": "모멘텀은 여전히 상방 쪽에 기울어 있고",
        "still leaning lower": "모멘텀은 여전히 하방 쪽에 기울어 있고",
        "has stabilized": "모멘텀은 안정화되고 있으며",
    }
    return mapping.get(value, value)


def _map_momentum_tail(value: str) -> str:
    mapping = {
        "and participation has improved": "수급 참여도도 개선되고 있습니다",
        "but volume is still not doing much": "거래량 확인은 아직 약합니다",
        "with mixed confirmation underneath the surface": "하부 확인 신호는 아직 엇갈립니다",
        "while the chart remains compressed": "차트는 아직 압축 상태에 있습니다",
    }
    return mapping.get(value, value)
