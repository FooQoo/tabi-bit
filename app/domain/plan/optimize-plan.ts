import type { GeneratedSpot } from "~/domain/spot/spot";
import type { OptimizedPlan, PlanConstraints } from "~/domain/plan/plan";
import { orderSpotsByRoute } from "~/domain/plan/route-order";
import {
  buildTravelLegs,
  estimateTravel,
  routeTravelMinutes,
} from "~/domain/plan/travel";

/** プランに含めるスポットの上限。 */
const MAX_PLAN_SPOTS = 5;

/** この件数に達するまでは多様性（カテゴリ・地域の重複）を抑制する。 */
const VARIETY_LOOKAHEAD = 3;

/** スコアリングの重み。値を一箇所に集約して調整しやすくする。 */
const WEIGHTS = {
  /** 寄り道度 1 段階あたりの加点。 */
  detourBonusPerLevel: 12,
  /** 滞在が手頃（compact）なときの加点。 */
  compactBonus: 8,
  compactMinMinutes: 20,
  compactMaxMinutes: 90,
  /** この滞在分を超えた分だけ減点（step 分ごとに 1）。 */
  durationSoftCapMinutes: 90,
  durationPenaltyStepMinutes: 30,
  /** 予算中央値をこの額で割った分を減点。 */
  budgetPenaltyDivisor: 3000,
  /** 直近クラスタからの移動 1 分あたりの減点。 */
  travelPenaltyPerMinute: 0.7,
  /** カテゴリ・地域が重複したときの減点。 */
  varietyPenalty: 18,
} as const;

export function optimizePlan(
  spots: GeneratedSpot[],
  constraints: PlanConstraints,
  pinnedSpotIds: Set<string>,
  blacklistedSpotIds: Set<string>,
): OptimizedPlan {
  const eligibleSpots = spots.filter((s) => !blacklistedSpotIds.has(s.id));
  const pinnedSpots = eligibleSpots.filter((s) => pinnedSpotIds.has(s.id));
  const unpinnedSpots = eligibleSpots.filter((s) => !pinnedSpotIds.has(s.id));

  // ピン留めは無条件に採用する（外せない前提）。
  const selectedSpots: GeneratedSpot[] = [...pinnedSpots];
  const usedCategories = new Set<string>(pinnedSpots.map((s) => s.category));
  const usedMunicipalities = new Set<string>(
    pinnedSpots.map((s) => municipalityKeyOf(s)),
  );

  // 残りスロットを静的スコア順の非ピンスポットで埋める。
  const scoredUnpinned = unpinnedSpots
    .map((spot) => ({ spot, score: staticScore(spot) }))
    .sort((a, b) => b.score - a.score);

  while (selectedSpots.length < MAX_PLAN_SPOTS) {
    const nextSpot = pickNextSpot(
      selectedSpots,
      scoredUnpinned,
      usedCategories,
      usedMunicipalities,
      constraints,
    );

    if (!nextSpot) break;

    selectedSpots.push(nextSpot);
    usedCategories.add(nextSpot.category);
    usedMunicipalities.add(municipalityKeyOf(nextSpot));
  }

  // 採用スポットを移動時間が最小になる訪問順に並べ替える。
  const orderedSpots = orderSpotsByRoute(selectedSpots);
  const travelLegs = buildTravelLegs(orderedSpots);
  const totalStayMinutes = sumStayMinutes(orderedSpots);
  const totalTravelMinutes = travelLegs.reduce(
    (total, leg) => total + leg.minutes,
    0,
  );
  const totalDurationMinutes = totalStayMinutes + totalTravelMinutes;
  const totalBudgetMax = sumBudgetMax(orderedSpots);

  return {
    spots: orderedSpots,
    travelLegs,
    totalStayMinutes,
    totalTravelMinutes,
    totalDurationMinutes,
    totalBudgetYen: orderedSpots.reduce(
      (total, spot) => ({
        min: total.min + spot.budgetYen.min,
        max: total.max + spot.budgetYen.max,
      }),
      { min: 0, max: 0 },
    ),
    averageDetourLevel:
      orderedSpots.length === 0
        ? 0
        : orderedSpots.reduce((total, spot) => total + spot.detourLevel, 0) /
          orderedSpots.length,
    categoryCount: new Set(orderedSpots.map((spot) => spot.category)).size,
    durationExceeded:
      constraints.maxDurationMinutes !== undefined &&
      totalDurationMinutes > constraints.maxDurationMinutes,
    budgetExceeded:
      constraints.maxBudgetYen !== undefined &&
      totalBudgetMax > constraints.maxBudgetYen,
    pinnedSpotIds,
  };
}

/** 制約を満たし、調整後スコアが最大の非ピンスポットを 1 件選ぶ。 */
function pickNextSpot(
  selectedSpots: GeneratedSpot[],
  scoredUnpinned: Array<{ spot: GeneratedSpot; score: number }>,
  usedCategories: Set<string>,
  usedMunicipalities: Set<string>,
  constraints: PlanConstraints,
): GeneratedSpot | null {
  let best: { spot: GeneratedSpot; score: number } | null = null;

  for (const { spot, score } of scoredUnpinned) {
    if (selectedSpots.some((s) => s.id === spot.id)) continue;
    if (!fitsConstraints(selectedSpots, spot, constraints)) continue;

    const travelMinutes = travelToNearest(selectedSpots, spot);
    const hasEnoughVariety = selectedSpots.length >= VARIETY_LOOKAHEAD;
    const isDuplicate =
      usedCategories.has(spot.category) ||
      usedMunicipalities.has(municipalityKeyOf(spot));
    const varietyPenalty =
      !hasEnoughVariety && isDuplicate ? WEIGHTS.varietyPenalty : 0;

    const adjustedScore =
      score - travelMinutes * WEIGHTS.travelPenaltyPerMinute - varietyPenalty;

    if (!best || adjustedScore > best.score) {
      best = { spot, score: adjustedScore };
    }
  }

  return best?.spot ?? null;
}

function staticScore(spot: GeneratedSpot): number {
  const budgetMidpoint = (spot.budgetYen.min + spot.budgetYen.max) / 2;
  const durationPenalty =
    Math.max(0, spot.durationMinutes - WEIGHTS.durationSoftCapMinutes) /
    WEIGHTS.durationPenaltyStepMinutes;
  const budgetPenalty = budgetMidpoint / WEIGHTS.budgetPenaltyDivisor;
  const detourBonus = spot.detourLevel * WEIGHTS.detourBonusPerLevel;
  const compactBonus =
    spot.durationMinutes >= WEIGHTS.compactMinMinutes &&
    spot.durationMinutes <= WEIGHTS.compactMaxMinutes
      ? WEIGHTS.compactBonus
      : 0;
  return detourBonus + compactBonus - durationPenalty - budgetPenalty;
}

/** 候補と既選択クラスタとの近さ（最寄りスポットへの移動分）。順序に依存しない。 */
function travelToNearest(
  selectedSpots: GeneratedSpot[],
  candidate: GeneratedSpot,
): number {
  if (selectedSpots.length === 0) return 0;
  return Math.min(
    ...selectedSpots.map((spot) => estimateTravel(spot, candidate).minutes),
  );
}

/**
 * 候補を加えても制約内に収まるか判定する。
 * 所要時間は最適化後の訪問順で評価し、表示プランと整合させる。
 */
function fitsConstraints(
  selectedSpots: GeneratedSpot[],
  candidate: GeneratedSpot,
  constraints: PlanConstraints,
): boolean {
  const tentative = [...selectedSpots, candidate];

  if (constraints.maxBudgetYen !== undefined) {
    if (sumBudgetMax(tentative) > constraints.maxBudgetYen) return false;
  }

  if (constraints.maxDurationMinutes !== undefined) {
    const ordered = orderSpotsByRoute(tentative);
    const duration = sumStayMinutes(ordered) + routeTravelMinutes(ordered);
    if (duration > constraints.maxDurationMinutes) return false;
  }

  return true;
}

function municipalityKeyOf(spot: GeneratedSpot): string {
  return spot.municipality ?? spot.name;
}

function sumStayMinutes(spots: GeneratedSpot[]): number {
  return spots.reduce((total, spot) => total + spot.durationMinutes, 0);
}

function sumBudgetMax(spots: GeneratedSpot[]): number {
  return spots.reduce((total, spot) => total + spot.budgetYen.max, 0);
}
