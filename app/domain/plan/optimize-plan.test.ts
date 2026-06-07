import { describe, expect, it } from "vitest";

import { optimizePlan } from "~/domain/plan/optimize-plan";
import { routeTravelMinutes } from "~/domain/plan/travel";
import { makeSpot } from "~/domain/plan/__fixtures__/spot";

const noConstraints = {};
const noPins = new Set<string>();
const noBlacklist = new Set<string>();

describe("optimizePlan", () => {
  it("空配列なら空プランを返す", () => {
    const plan = optimizePlan([], noConstraints, noPins, noBlacklist);
    expect(plan.spots).toEqual([]);
    expect(plan.totalDurationMinutes).toBe(0);
    expect(plan.totalBudgetYen).toEqual({ min: 0, max: 0 });
    expect(plan.averageDetourLevel).toBe(0);
  });

  it("ブラックリストのスポットを除外する", () => {
    const spots = [
      makeSpot({ id: "keep" }),
      makeSpot({ id: "drop" }),
    ];
    const plan = optimizePlan(
      spots,
      noConstraints,
      noPins,
      new Set(["drop"]),
    );
    expect(plan.spots.map((s) => s.id)).not.toContain("drop");
    expect(plan.spots.map((s) => s.id)).toContain("keep");
  });

  it("採用スポットは最大 5 件", () => {
    const spots = Array.from({ length: 10 }, (_, i) =>
      makeSpot({ id: `s${i}`, latitude: 35 + i * 0.01 }),
    );
    const plan = optimizePlan(spots, noConstraints, noPins, noBlacklist);
    expect(plan.spots).toHaveLength(5);
  });

  it("ピン留めは無条件に含める（上限を超えても）", () => {
    const pinnedIds = ["p0", "p1", "p2", "p3", "p4", "p5"];
    const pinnedSet = new Set(pinnedIds);
    const spots = pinnedIds.map((id, i) =>
      makeSpot({ id, latitude: 35 + i * 0.01 }),
    );
    const plan = optimizePlan(spots, noConstraints, pinnedSet, noBlacklist);
    expect(plan.spots).toHaveLength(6);
    expect(plan.spots.map((s) => s.id).sort()).toEqual([...pinnedIds].sort());
    expect(plan.pinnedSpotIds).toBe(pinnedSet);
  });

  it("訪問順を移動時間が最小になるよう並べ替える", () => {
    // 一直線上のスポットを全てピン留めし、確実に 3 件採用させる。
    const ids = ["a", "b", "c"];
    const spots = ids.map((id, i) =>
      makeSpot({
        id,
        prefecture: "北海道",
        latitude: 43.0 + i * 0.1,
        longitude: 141.0,
      }),
    );
    const shuffled = [spots[2], spots[0], spots[1]];
    const plan = optimizePlan(
      shuffled,
      noConstraints,
      new Set(ids),
      noBlacklist,
    );
    const orderedIds = plan.spots.map((s) => s.id);
    const monotonic =
      orderedIds.join() === "a,b,c" || orderedIds.join() === "c,b,a";
    expect(monotonic).toBe(true);
    expect(plan.totalTravelMinutes).toBe(routeTravelMinutes(plan.spots));
  });

  it("所要時間の制約を超えないように非ピンを抑える", () => {
    const spots = Array.from({ length: 8 }, (_, i) =>
      makeSpot({
        id: `s${i}`,
        durationMinutes: 120,
        latitude: 35 + i * 0.05,
      }),
    );
    const plan = optimizePlan(
      spots,
      { maxDurationMinutes: 300 },
      noPins,
      noBlacklist,
    );
    expect(plan.totalDurationMinutes).toBeLessThanOrEqual(300);
    expect(plan.durationExceeded).toBe(false);
  });

  it("予算の制約を超えないように非ピンを抑える", () => {
    const spots = Array.from({ length: 8 }, (_, i) =>
      makeSpot({ id: `s${i}`, budgetYen: { min: 1000, max: 2000 } }),
    );
    const plan = optimizePlan(
      spots,
      { maxBudgetYen: 5000 },
      noPins,
      noBlacklist,
    );
    expect(plan.totalBudgetYen.max).toBeLessThanOrEqual(5000);
    expect(plan.budgetExceeded).toBe(false);
  });

  it("ピン留めだけで制約超過なら exceeded フラグを立てる", () => {
    const pinnedIds = ["p0", "p1", "p2"];
    const spots = pinnedIds.map((id, i) =>
      makeSpot({
        id,
        durationMinutes: 200,
        budgetYen: { min: 5000, max: 8000 },
        latitude: 35 + i * 0.1,
      }),
    );
    const plan = optimizePlan(
      spots,
      { maxDurationMinutes: 100, maxBudgetYen: 1000 },
      new Set(pinnedIds),
      noBlacklist,
    );
    expect(plan.spots).toHaveLength(3);
    expect(plan.durationExceeded).toBe(true);
    expect(plan.budgetExceeded).toBe(true);
  });
});
