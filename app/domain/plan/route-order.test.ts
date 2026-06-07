import { describe, expect, it } from "vitest";

import { orderSpotsByRoute } from "~/domain/plan/route-order";
import { routeTravelMinutes } from "~/domain/plan/travel";
import { makeSpot } from "~/domain/plan/__fixtures__/spot";

/**
 * 緯度方向に等間隔で並ぶスポット群（鉄道主要府県外＝対称な車移動）。
 * 水域横断ペナルティの影響を受けないよう、北海道内陸（道央）の陸地に並べる。
 */
function collinearSpots(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeSpot({
      id: `p${i}`,
      prefecture: "北海道",
      latitude: 43.3 + i * 0.08,
      longitude: 142.4,
    }),
  );
}

describe("orderSpotsByRoute", () => {
  it("2 件以下はそのままコピーを返す", () => {
    const spots = [makeSpot({ id: "a" }), makeSpot({ id: "b" })];
    const ordered = orderSpotsByRoute(spots);
    expect(ordered.map((s) => s.id)).toEqual(["a", "b"]);
    expect(ordered).not.toBe(spots);
  });

  it("一直線上のスポットを単調な順に並べ替える（厳密探索）", () => {
    const sorted = collinearSpots(5);
    const shuffled = [sorted[3], sorted[0], sorted[4], sorted[1], sorted[2]];

    const ordered = orderSpotsByRoute(shuffled);
    const ids = ordered.map((s) => s.id);
    const ascending = sorted.map((s) => s.id);

    // 端から端へ単調に辿るのが最短（昇順 or その反転）。
    const isMonotonic =
      ids.join() === ascending.join() ||
      ids.join() === [...ascending].reverse().join();
    expect(isMonotonic).toBe(true);
  });

  it("並べ替え後の移動時間は入力順以下になる", () => {
    const sorted = collinearSpots(5);
    const shuffled = [sorted[2], sorted[4], sorted[0], sorted[3], sorted[1]];
    const ordered = orderSpotsByRoute(shuffled);
    expect(routeTravelMinutes(ordered)).toBeLessThanOrEqual(
      routeTravelMinutes(shuffled),
    );
  });

  it("厳密探索の上限を超える件数でも改善（NN+2opt）", () => {
    const sorted = collinearSpots(9);
    const shuffled = [...sorted].reverse();
    shuffled.push(shuffled.splice(2, 1)[0]); // 少し崩す
    const ordered = orderSpotsByRoute(shuffled);
    expect(routeTravelMinutes(ordered)).toBeLessThanOrEqual(
      routeTravelMinutes(shuffled),
    );
  });
});
