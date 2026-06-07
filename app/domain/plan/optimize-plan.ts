import type { GeneratedSpot } from "~/domain/spot/spot";
import type { OptimizedPlan, PlanConstraints } from "~/domain/plan/plan";
import { buildTravelLegs, estimateTravel } from "~/domain/plan/travel";

export function optimizePlan(
  spots: GeneratedSpot[],
  constraints: PlanConstraints,
  pinnedSpotIds: Set<string>,
  blacklistedSpotIds: Set<string>,
): OptimizedPlan {
  const eligibleSpots = spots.filter((s) => !blacklistedSpotIds.has(s.id));
  const pinnedSpots = eligibleSpots.filter((s) => pinnedSpotIds.has(s.id));
  const unpinnedSpots = eligibleSpots.filter((s) => !pinnedSpotIds.has(s.id));

  const selectedSpots: GeneratedSpot[] = [...pinnedSpots];
  const usedCategories = new Set<string>(pinnedSpots.map((s) => s.category));
  const usedMunicipalities = new Set<string>(
    pinnedSpots.map((s) => s.municipality ?? s.name),
  );

  // 残りスロットをスコア順に非ピンスポットで埋める
  const scoredUnpinned = unpinnedSpots
    .map((spot) => {
      const budgetMidpoint = (spot.budgetYen.min + spot.budgetYen.max) / 2;
      const durationPenalty = Math.max(0, spot.durationMinutes - 90) / 30;
      const budgetPenalty = budgetMidpoint / 3000;
      const detourBonus = spot.detourLevel * 12;
      const compactBonus =
        spot.durationMinutes >= 20 && spot.durationMinutes <= 90 ? 8 : 0;
      return {
        spot,
        score: detourBonus + compactBonus - durationPenalty - budgetPenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  while (selectedSpots.length < 5) {
    const nextEntry = scoredUnpinned
      .filter(
        ({ spot }) =>
          !selectedSpots.some((s) => s.id === spot.id) &&
          canAddSpot(selectedSpots, spot, constraints),
      )
      .map(({ score, spot }) => {
        const previousSpot = selectedSpots.at(-1);
        const travelMinutes = previousSpot
          ? estimateTravel(previousSpot, spot).minutes
          : 0;
        const municipalityKey = spot.municipality ?? spot.name;
        const hasEnoughVariety = selectedSpots.length >= 3;
        const varietyPenalty =
          !hasEnoughVariety &&
          (usedCategories.has(spot.category) ||
            usedMunicipalities.has(municipalityKey))
            ? 18
            : 0;
        return { score: score - travelMinutes * 0.7 - varietyPenalty, spot };
      })
      .sort((a, b) => b.score - a.score)[0];

    if (!nextEntry) break;

    const { spot } = nextEntry;
    const municipalityKey = spot.municipality ?? spot.name;
    selectedSpots.push(spot);
    usedCategories.add(spot.category);
    usedMunicipalities.add(municipalityKey);
  }

  const travelLegs = buildTravelLegs(selectedSpots);
  const totalStayMinutes = selectedSpots.reduce(
    (total, spot) => total + spot.durationMinutes,
    0,
  );
  const totalTravelMinutes = travelLegs.reduce(
    (total, leg) => total + leg.minutes,
    0,
  );
  const totalDurationMinutes = totalStayMinutes + totalTravelMinutes;
  const totalBudgetMax = selectedSpots.reduce(
    (total, spot) => total + spot.budgetYen.max,
    0,
  );

  return {
    spots: selectedSpots,
    travelLegs,
    totalStayMinutes,
    totalTravelMinutes,
    totalDurationMinutes,
    totalBudgetYen: selectedSpots.reduce(
      (total, spot) => ({
        min: total.min + spot.budgetYen.min,
        max: total.max + spot.budgetYen.max,
      }),
      { min: 0, max: 0 },
    ),
    averageDetourLevel:
      selectedSpots.length === 0
        ? 0
        : selectedSpots.reduce((total, spot) => total + spot.detourLevel, 0) /
          selectedSpots.length,
    categoryCount: new Set(selectedSpots.map((spot) => spot.category)).size,
    durationExceeded:
      constraints.maxDurationMinutes !== undefined &&
      totalDurationMinutes > constraints.maxDurationMinutes,
    budgetExceeded:
      constraints.maxBudgetYen !== undefined &&
      totalBudgetMax > constraints.maxBudgetYen,
    pinnedSpotIds,
  };
}

function canAddSpot(
  selectedSpots: GeneratedSpot[],
  nextSpot: GeneratedSpot,
  constraints: PlanConstraints,
) {
  const travelMinutes =
    selectedSpots.length === 0
      ? 0
      : estimateTravel(selectedSpots[selectedSpots.length - 1], nextSpot)
          .minutes;
  const nextDuration =
    selectedSpots.reduce((total, spot) => total + spot.durationMinutes, 0) +
    buildTravelLegs(selectedSpots).reduce(
      (total, leg) => total + leg.minutes,
      0,
    ) +
    nextSpot.durationMinutes +
    travelMinutes;
  const nextBudget =
    selectedSpots.reduce((total, spot) => total + spot.budgetYen.max, 0) +
    nextSpot.budgetYen.max;

  if (
    constraints.maxDurationMinutes !== undefined &&
    nextDuration > constraints.maxDurationMinutes
  ) {
    return false;
  }

  if (
    constraints.maxBudgetYen !== undefined &&
    nextBudget > constraints.maxBudgetYen
  ) {
    return false;
  }

  return true;
}
