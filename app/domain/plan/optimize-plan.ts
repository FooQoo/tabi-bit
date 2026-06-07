import type { GeneratedSpot, SpotCategory } from "~/domain/spot/spot";
import type { OptimizedPlan, PlanConstraints } from "~/domain/plan/plan";
import {
  nearestNeighborOrder,
  orderSpotsByRoute,
} from "~/domain/plan/route-order";
import {
  buildSchedule,
  DEFAULT_START_MINUTES,
  timeOfDayMismatch,
} from "~/domain/plan/schedule";
import {
  buildTravelLegs,
  estimateTravel,
  routeTravelMinutes,
} from "~/domain/plan/travel";

/** プランに含めるスポットの既定上限。 */
const MAX_PLAN_SPOTS = 5;

/** この件数に達するまでは多様性（カテゴリ・地域の重複）を抑制する。 */
const VARIETY_LOOKAHEAD = 3;

/** スコアリングの重み（バランス案の既定値）。 */
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
  /** 予算中央値をこの額で割った分を加点（贅沢プラン用。0 で無効）。 */
  budgetBonusDivisor: 0,
  /** 直近クラスタからの移動 1 分あたりの減点。 */
  travelPenaltyPerMinute: 0.7,
  /** カテゴリ・地域が重複したときの減点。 */
  varietyPenalty: 18,
} as const;

/** 訪問順の評価に用いる時刻関連ペナルティ（分換算）。 */
const SCHEDULE_PENALTY = {
  /** 希望時間帯と実際の時間帯がずれたときの減点。 */
  timeOfDayMismatch: 30,
  /** 営業時間外で見学できないときの減点（実質的に回避させる大きさ）。 */
  closedConflict: 600,
  /** 飲食系（食事・カフェ）が連続したときの減点（実質的に回避させる大きさ）。 */
  mealAdjacency: 600,
} as const;

/** 連続を避けたい飲食系カテゴリ。 */
const MEAL_CATEGORIES = new Set<SpotCategory>(["food", "cafe"]);

type PlanWeights = Record<keyof typeof WEIGHTS, number>;
type CategoryBoost = Partial<Record<SpotCategory, number>>;

/** プランの性格を決めるプロファイル。重み・上限・カテゴリ加点を切り替える。 */
export type PlanProfile = {
  id: string;
  label: string;
  description: string;
  /** スポット数の上限。 */
  maxSpots: number;
  /** 既定の重みへの部分上書き。 */
  weights: Partial<PlanWeights>;
  /** カテゴリごとの加点。 */
  categoryBoost: CategoryBoost;
};

/** 提案する複数プランのプロファイル一覧。 */
export const PLAN_PROFILES: PlanProfile[] = [
  {
    id: "balanced",
    label: "バランス",
    description: "寄り道度・時間・予算・分散をならして選びます。",
    maxSpots: MAX_PLAN_SPOTS,
    weights: {},
    categoryBoost: {},
  },
  {
    id: "relaxed",
    label: "ゆったり",
    description: "件数を絞り、移動が少なく落ち着けるスポット中心に。",
    maxSpots: 3,
    weights: { travelPenaltyPerMinute: 1.4, compactBonus: 14 },
    categoryBoost: { relax: 10, cafe: 8, view: 6 },
  },
  {
    id: "packed",
    label: "詰め込み",
    description: "移動を許容して、できるだけ多くのスポットを回ります。",
    maxSpots: 7,
    weights: { travelPenaltyPerMinute: 0.35 },
    categoryBoost: { activity: 6 },
  },
  {
    id: "foodie",
    label: "食重視",
    description: "食事とカフェを優先して組み立てます。",
    maxSpots: MAX_PLAN_SPOTS,
    weights: {},
    categoryBoost: { food: 20, cafe: 14 },
  },
  {
    id: "luxury",
    label: "贅沢",
    description: "予算の上限近くまで、少し贅沢なスポットを選びます。",
    // 件数ではなく予算を上限の制約にしたいので、スロットは多めに用意する。
    maxSpots: 8,
    // 予算ペナルティを実質無効化し、代わりに予算額そのものを強く加点に回す。
    weights: { budgetPenaltyDivisor: Number.MAX_SAFE_INTEGER, budgetBonusDivisor: 100 },
    categoryBoost: {},
  },
];

/**
 * 各プロファイルでプランを生成して返す。
 * ピン留め・ブラックリストはどのプランにも共通で効く。
 */
export function generatePlans(
  spots: GeneratedSpot[],
  constraints: PlanConstraints,
  pinnedSpotIds: Set<string>,
  blacklistedSpotIds: Set<string>,
): Array<{ profile: PlanProfile; plan: OptimizedPlan }> {
  return PLAN_PROFILES.map((profile) => ({
    profile,
    plan: optimizePlan(
      spots,
      constraints,
      pinnedSpotIds,
      blacklistedSpotIds,
      profile,
    ),
  }));
}

export function optimizePlan(
  spots: GeneratedSpot[],
  constraints: PlanConstraints,
  pinnedSpotIds: Set<string>,
  blacklistedSpotIds: Set<string>,
  profile?: PlanProfile,
): OptimizedPlan {
  const weights: PlanWeights = { ...WEIGHTS, ...profile?.weights };
  const categoryBoost: CategoryBoost = profile?.categoryBoost ?? {};
  const maxSpots = profile?.maxSpots ?? MAX_PLAN_SPOTS;

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
    .map((spot) => ({ spot, score: staticScore(spot, weights, categoryBoost) }))
    .sort((a, b) => b.score - a.score);

  while (selectedSpots.length < maxSpots) {
    const nextSpot = pickNextSpot(
      selectedSpots,
      scoredUnpinned,
      usedCategories,
      usedMunicipalities,
      constraints,
      weights,
    );

    if (!nextSpot) break;

    selectedSpots.push(nextSpot);
    usedCategories.add(nextSpot.category);
    usedMunicipalities.add(municipalityKeyOf(nextSpot));
  }

  // 出発時刻を含めて、移動 + 開店待ち + 時間帯フィット + 閉店抵触 +
  // 飲食連続回避が最小になる訪問順に並べ替える。
  const startMinutes = constraints.startMinutes ?? DEFAULT_START_MINUTES;
  const costFn = (candidate: GeneratedSpot[]) =>
    scheduleCost(candidate, startMinutes);
  let orderedSpots = orderSpotsByRoute(selectedSpots, costFn);

  // 最終的な訪問順は移動以外（待ち・時間帯・飲食連続回避）も加味して決まるため、
  // 選定時に用いた移動上界より実移動が大きくなり、所要時間上限を超えることがある。
  // その場合は価値の低い非ピンスポットから外し、上限内に収め直す。
  if (constraints.maxDurationMinutes !== undefined) {
    const scoreOf = new Map(
      scoredUnpinned.map(({ spot, score }) => [spot.id, score]),
    );
    while (
      sumStayMinutes(orderedSpots) + routeTravelMinutes(orderedSpots) >
        constraints.maxDurationMinutes &&
      orderedSpots.some((spot) => !pinnedSpotIds.has(spot.id))
    ) {
      const worst = lowestScoreUnpinned(orderedSpots, pinnedSpotIds, scoreOf);
      if (!worst) break;
      orderedSpots = orderSpotsByRoute(
        orderedSpots.filter((spot) => spot.id !== worst),
        costFn,
      );
    }
  }

  const scheduledStops = buildSchedule(orderedSpots, startMinutes);
  const travelLegs = buildTravelLegs(orderedSpots);
  const totalStayMinutes = sumStayMinutes(orderedSpots);
  const totalTravelMinutes = travelLegs.reduce(
    (total, leg) => total + leg.minutes,
    0,
  );
  const totalWaitMinutes = scheduledStops.reduce(
    (total, stop) => total + stop.waitMinutes,
    0,
  );
  const totalDurationMinutes = totalStayMinutes + totalTravelMinutes;
  const endMinutes =
    scheduledStops.length === 0
      ? startMinutes
      : scheduledStops[scheduledStops.length - 1].departureMinutes;
  const totalBudgetMax = sumBudgetMax(orderedSpots);

  return {
    spots: orderedSpots,
    travelLegs,
    scheduledStops,
    totalStayMinutes,
    totalTravelMinutes,
    totalWaitMinutes,
    totalDurationMinutes,
    startMinutes,
    endMinutes,
    hasClosedConflict: scheduledStops.some((stop) => stop.closedConflict),
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
  weights: PlanWeights,
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
      !hasEnoughVariety && isDuplicate ? weights.varietyPenalty : 0;

    const adjustedScore =
      score - travelMinutes * weights.travelPenaltyPerMinute - varietyPenalty;

    if (!best || adjustedScore > best.score) {
      best = { spot, score: adjustedScore };
    }
  }

  return best?.spot ?? null;
}

/**
 * 訪問順を評価するコスト。移動時間に加え、開店待ち・時間帯ミスマッチ・
 * 閉店抵触を分換算で合算する。小さいほど良い順路。
 */
function scheduleCost(orderedSpots: GeneratedSpot[], startMinutes: number): number {
  const schedule = buildSchedule(orderedSpots, startMinutes);
  let cost = routeTravelMinutes(orderedSpots);

  for (let i = 0; i < orderedSpots.length; i += 1) {
    const stop = schedule[i];
    cost += stop.waitMinutes;
    cost +=
      timeOfDayMismatch(orderedSpots[i], stop.arrivalMinutes) *
      SCHEDULE_PENALTY.timeOfDayMismatch;
    if (stop.closedConflict) {
      cost += SCHEDULE_PENALTY.closedConflict;
    }
    // 直前のスポットと連続で飲食系（食事・カフェ）になる並びを避ける。
    if (
      i > 0 &&
      MEAL_CATEGORIES.has(orderedSpots[i].category) &&
      MEAL_CATEGORIES.has(orderedSpots[i - 1].category)
    ) {
      cost += SCHEDULE_PENALTY.mealAdjacency;
    }
  }

  return cost;
}

function staticScore(
  spot: GeneratedSpot,
  weights: PlanWeights,
  categoryBoost: CategoryBoost,
): number {
  const budgetMidpoint = (spot.budgetYen.min + spot.budgetYen.max) / 2;
  const durationPenalty =
    Math.max(0, spot.durationMinutes - weights.durationSoftCapMinutes) /
    weights.durationPenaltyStepMinutes;
  const budgetPenalty = budgetMidpoint / weights.budgetPenaltyDivisor;
  // 贅沢プランでは予算額が高いほど加点し、上限近くまで選び取らせる。
  const budgetBonus =
    weights.budgetBonusDivisor > 0
      ? budgetMidpoint / weights.budgetBonusDivisor
      : 0;
  const detourBonus = spot.detourLevel * weights.detourBonusPerLevel;
  const compactBonus =
    spot.durationMinutes >= weights.compactMinMinutes &&
    spot.durationMinutes <= weights.compactMaxMinutes
      ? weights.compactBonus
      : 0;
  const boost = categoryBoost[spot.category] ?? 0;
  return (
    detourBonus +
    compactBonus +
    boost +
    budgetBonus -
    durationPenalty -
    budgetPenalty
  );
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
 *
 * 所要時間は nearest-neighbor 経路の「上界」で評価する。上界が収まれば
 * 厳密な最短順も必ず収まるため、限度超過のプランを選んでしまうことはない
 * （厳密な最短順は最終段で一度だけ求める）。内ループで全順列探索していた
 * のをやめ、件数が増えても破綻しないようにする。
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
    const travelUpperBound = routeTravelMinutes(nearestNeighborOrder(tentative));
    const duration = sumStayMinutes(tentative) + travelUpperBound;
    if (duration > constraints.maxDurationMinutes) return false;
  }

  return true;
}

/** 順路中の非ピンスポットのうち、最もスコアの低いスポット id を返す。 */
function lowestScoreUnpinned(
  orderedSpots: GeneratedSpot[],
  pinnedSpotIds: Set<string>,
  scoreOf: Map<string, number>,
): string | null {
  let worstId: string | null = null;
  let worstScore = Number.POSITIVE_INFINITY;
  for (const spot of orderedSpots) {
    if (pinnedSpotIds.has(spot.id)) continue;
    const score = scoreOf.get(spot.id) ?? 0;
    if (score < worstScore) {
      worstScore = score;
      worstId = spot.id;
    }
  }
  return worstId;
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
