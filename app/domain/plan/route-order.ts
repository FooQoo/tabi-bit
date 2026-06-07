import type { GeneratedSpot } from "~/domain/spot/spot";
import { estimateTravel, routeTravelMinutes } from "~/domain/plan/travel";

/** これ以下の件数なら全順列を厳密探索する。超える場合は近似（NN + 2-opt）。 */
const EXACT_MAX = 7;

/**
 * 訪問順を移動時間が最小になるよう並べ替える（開放経路 / 出発・帰着の固定なし）。
 * 件数が少なければ厳密最適、多ければ nearest-neighbor + 2-opt の近似。
 */
export function orderSpotsByRoute(spots: GeneratedSpot[]): GeneratedSpot[] {
  if (spots.length <= 2) {
    return [...spots];
  }
  if (spots.length <= EXACT_MAX) {
    return exactOrder(spots);
  }
  return twoOpt(nearestNeighborOrder(spots));
}

function exactOrder(spots: GeneratedSpot[]): GeneratedSpot[] {
  let best = spots;
  let bestCost = routeTravelMinutes(spots);

  for (const permutation of permute(spots)) {
    const cost = routeTravelMinutes(permutation);
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
  // 各始点から貪欲に最近スポットを辿り、最も短い経路を採用する。
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

function twoOpt(initial: GeneratedSpot[]): GeneratedSpot[] {
  let route = [...initial];
  let bestCost = routeTravelMinutes(route);
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
        const cost = routeTravelMinutes(candidate);
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
