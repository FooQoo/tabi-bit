import type { GeneratedSpot } from "~/domain/spot/spot";
import { estimateTravel, routeTravelMinutes } from "~/domain/plan/travel";

/** これ以下の件数なら全順列を厳密探索する。超える場合は近似（NN + 2-opt）。 */
const EXACT_MAX = 7;

/** 並び順を評価するコスト関数。小さいほど良い。 */
export type RouteCost = (orderedSpots: GeneratedSpot[]) => number;

/**
 * 訪問順をコスト最小になるよう並べ替える（開放経路 / 出発・帰着の固定なし）。
 * 既定のコストは移動時間。時刻フィットなどを含めたい場合は costFn を渡す。
 * 件数が少なければ厳密最適、多ければ nearest-neighbor + 2-opt の近似。
 */
export function orderSpotsByRoute(
  spots: GeneratedSpot[],
  costFn: RouteCost = routeTravelMinutes,
): GeneratedSpot[] {
  if (spots.length <= 2) {
    // 2 件でも順序でコストが変わりうるので両方評価する。
    if (spots.length === 2 && costFn([spots[1], spots[0]]) < costFn(spots)) {
      return [spots[1], spots[0]];
    }
    return [...spots];
  }
  if (spots.length <= EXACT_MAX) {
    return exactOrder(spots, costFn);
  }
  return twoOpt(nearestNeighborOrder(spots), costFn);
}

function exactOrder(spots: GeneratedSpot[], costFn: RouteCost): GeneratedSpot[] {
  let best = spots;
  let bestCost = costFn(spots);

  for (const permutation of permute(spots)) {
    const cost = costFn(permutation);
    if (cost < bestCost) {
      best = permutation;
      bestCost = cost;
    }
  }

  return [...best];
}

function* permute(spots: GeneratedSpot[]): Generator<GeneratedSpot[]> {
  if (spots.length <= 1) {
    yield [...spots];
    return;
  }
  for (let index = 0; index < spots.length; index += 1) {
    const rest = [...spots.slice(0, index), ...spots.slice(index + 1)];
    for (const sub of permute(rest)) {
      yield [spots[index], ...sub];
    }
  }
}

function nearestNeighborOrder(spots: GeneratedSpot[]): GeneratedSpot[] {
  // 各始点から貪欲に最近スポットを辿り、最も短い経路を採用する（近似の初期解）。
  let best: GeneratedSpot[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let start = 0; start < spots.length; start += 1) {
    const remaining = [...spots];
    const [first] = remaining.splice(start, 1);
    const tour = [first];

    while (remaining.length > 0) {
      const last = tour[tour.length - 1];
      let nearestIndex = 0;
      let nearestMinutes = Number.POSITIVE_INFINITY;
      for (let i = 0; i < remaining.length; i += 1) {
        const minutes = estimateTravel(last, remaining[i]).minutes;
        if (minutes < nearestMinutes) {
          nearestMinutes = minutes;
          nearestIndex = i;
        }
      }
      tour.push(remaining.splice(nearestIndex, 1)[0]);
    }

    const cost = routeTravelMinutes(tour);
    if (cost < bestCost) {
      bestCost = cost;
      best = tour;
    }
  }

  return best ?? [...spots];
}

function twoOpt(initial: GeneratedSpot[], costFn: RouteCost): GeneratedSpot[] {
  let route = [...initial];
  let bestCost = costFn(route);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i += 1) {
      for (let k = i + 1; k < route.length; k += 1) {
        const candidate = [
          ...route.slice(0, i),
          ...route.slice(i, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        const cost = costFn(candidate);
        if (cost < bestCost) {
          route = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }

  return route;
}
