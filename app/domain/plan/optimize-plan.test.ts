import { describe, expect, it } from "vitest";

import {
  generatePlans,
  optimizePlan,
  PLAN_PROFILES,
} from "~/domain/plan/optimize-plan";
import {
  calculateDistanceKm,
  estimateTravel,
  routeTravelMinutes,
} from "~/domain/plan/travel";
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

  it("多数スポット＋所要時間制約でも限度内に収める", () => {
    // 内ループで全順列探索していた頃に重くなっていた経路。
    // 件数を増やしても破綻せず、限度内に収まることを確認する。
    const spots = Array.from({ length: 60 }, (_, i) =>
      makeSpot({
        id: `s${i}`,
        durationMinutes: 90,
        latitude: 35 + (i % 10) * 0.03,
        longitude: 139 + Math.floor(i / 10) * 0.03,
      }),
    );
    const plan = optimizePlan(
      spots,
      { maxDurationMinutes: 360 },
      noPins,
      noBlacklist,
    );
    expect(plan.totalDurationMinutes).toBeLessThanOrEqual(360);
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

  it("スケジュール情報を付与する（既定の出発は 10:00）", () => {
    const spots = [makeSpot({ id: "a", durationMinutes: 30 })];
    const plan = optimizePlan(spots, noConstraints, noPins, noBlacklist);
    expect(plan.startMinutes).toBe(600);
    expect(plan.scheduledStops).toHaveLength(1);
    expect(plan.scheduledStops[0]).toMatchObject({
      spotId: "a",
      arrivalMinutes: 600,
      departureMinutes: 630,
    });
    expect(plan.endMinutes).toBe(630);
  });

  it("希望時間帯に合うよう訪問順を決める", () => {
    // 同一座標（移動コスト同一）。時間帯フィットだけで順序が決まる。
    const ids = ["m", "e"];
    const spots = [
      makeSpot({ id: "m", idealTimeOfDay: "morning", durationMinutes: 60 }),
      makeSpot({ id: "e", idealTimeOfDay: "evening", durationMinutes: 60 }),
    ];
    const plan = optimizePlan(spots, noConstraints, new Set(ids), noBlacklist);
    // 10:00 出発なら朝向きを先に回すのが低コスト。
    expect(plan.spots[0].id).toBe("m");
  });

  it("営業時間外を避ける順路を選ぶ", () => {
    const ids = ["open", "early"];
    const spots = [
      makeSpot({ id: "open", durationMinutes: 60 }),
      makeSpot({
        id: "early",
        durationMinutes: 60,
        openingHours: { open: "06:00", close: "11:00" },
      }),
    ];
    const plan = optimizePlan(spots, noConstraints, new Set(ids), noBlacklist);
    // 早く閉まる "early" を先に回せば抵触しない。
    expect(plan.spots[0].id).toBe("early");
    expect(plan.hasClosedConflict).toBe(false);
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

describe("generatePlans", () => {
  it("プロファイルごとに 1 プランずつ返す", () => {
    const spots = Array.from({ length: 10 }, (_, i) =>
      makeSpot({ id: `s${i}`, latitude: 35 + i * 0.02 }),
    );
    const plans = generatePlans(spots, {}, noPins, noBlacklist);
    expect(plans).toHaveLength(PLAN_PROFILES.length);
    expect(plans.map((p) => p.profile.id)).toEqual(
      PLAN_PROFILES.map((p) => p.id),
    );
  });

  it("ゆったりは件数を絞り、詰め込みは多く回る", () => {
    const spots = Array.from({ length: 10 }, (_, i) =>
      makeSpot({ id: `s${i}`, latitude: 35 + i * 0.02 }),
    );
    const plans = generatePlans(spots, {}, noPins, noBlacklist);
    const relaxed = plans.find((p) => p.profile.id === "relaxed")!.plan;
    const packed = plans.find((p) => p.profile.id === "packed")!.plan;

    expect(relaxed.spots.length).toBeLessThanOrEqual(3);
    expect(packed.spots.length).toBeGreaterThan(relaxed.spots.length);
  });

  it("食重視は食事・カフェを優先する", () => {
    // 寄り道で勝る自然と、食重視の加点で勝る食事。
    // 飲食系は 1km 以上離す制約があるため、食事は十分に離して配置する
    // （緯度 0.02 ≒ 2.2km）。
    const nature = Array.from({ length: 3 }, (_, i) =>
      makeSpot({ id: `n${i}`, category: "nature", detourLevel: 2 }),
    );
    const food = Array.from({ length: 6 }, (_, i) =>
      makeSpot({
        id: `f${i}`,
        category: "food",
        detourLevel: 1,
        latitude: 35 + i * 0.02,
      }),
    );
    const spots = [...nature, ...food];

    const plans = generatePlans(spots, {}, noPins, noBlacklist);
    const balanced = plans.find((p) => p.profile.id === "balanced")!.plan;
    const foodie = plans.find((p) => p.profile.id === "foodie")!.plan;

    const countFood = (plan: typeof balanced) =>
      plan.spots.filter((s) => s.category === "food").length;

    expect(countFood(foodie)).toBeGreaterThan(countFood(balanced));
  });

  it("贅沢は予算上限近くまで、より高額なスポットを選ぶ", () => {
    // 同一座標（移動差なし）で、高額・安価のスポットを混在させる。
    const cheap = Array.from({ length: 5 }, (_, i) =>
      makeSpot({ id: `c${i}`, budgetYen: { min: 500, max: 1000 } }),
    );
    const pricey = Array.from({ length: 5 }, (_, i) =>
      makeSpot({ id: `p${i}`, budgetYen: { min: 5000, max: 8000 } }),
    );
    const spots = [...cheap, ...pricey];

    const plans = generatePlans(
      spots,
      { maxBudgetYen: 30000 },
      noPins,
      noBlacklist,
    );
    const balanced = plans.find((p) => p.profile.id === "balanced")!.plan;
    const luxury = plans.find((p) => p.profile.id === "luxury")!.plan;

    // 上限内に収まりつつ、バランス案より高い総額になる。
    expect(luxury.totalBudgetYen.max).toBeLessThanOrEqual(30000);
    expect(luxury.totalBudgetYen.max).toBeGreaterThan(balanced.totalBudgetYen.max);
    // 件数ではなく予算が制約になるよう、上限の 8 割以上まで使う。
    expect(luxury.totalBudgetYen.max).toBeGreaterThanOrEqual(24000);
  });

  it("贅沢でもピン留め済みスポットから海を渡る候補は採用しない", () => {
    const shiogama = makeSpot({
      id: "shiogama",
      name: "塩竈市街",
      prefecture: "宮城県",
      latitude: 38.315,
      longitude: 141.022,
      budgetYen: { min: 0, max: 0 },
    });
    const katsurashima = makeSpot({
      id: "katsurashima",
      name: "桂島",
      prefecture: "宮城県",
      latitude: 38.329,
      longitude: 141.106,
      budgetYen: { min: 3500, max: 4500 },
    });
    const inland = makeSpot({
      id: "inland",
      name: "多賀城",
      prefecture: "宮城県",
      latitude: 38.293,
      longitude: 141.005,
      budgetYen: { min: 1000, max: 1500 },
    });
    const luxury = PLAN_PROFILES.find((p) => p.id === "luxury");

    expect(estimateTravel(shiogama, katsurashima).crossesWater).toBe(true);
    expect(estimateTravel(shiogama, inland).crossesWater).toBe(false);

    const plan = optimizePlan(
      [shiogama, katsurashima, inland],
      { maxDurationMinutes: 360, maxBudgetYen: 5000 },
      new Set([shiogama.id]),
      noBlacklist,
      luxury,
    );

    expect(plan.spots.map((spot) => spot.id)).not.toContain("katsurashima");
    expect(plan.spots.map((spot) => spot.id)).toContain("inland");
    expect(plan.travelLegs.some((leg) => leg.crossesWater)).toBe(false);
  });

  it("非ピンのプランは所要時間上限を超えない（最終順で超えたら削る）", () => {
    // 近接した飲食系 2 件＋遠方 1 件。移動最短なら飲食が隣接するが、
    // 連続回避を優先すると遠方を間に挟んで移動が倍増し、選定時の
    // 移動上界を超える。最終順で超えた分を削って上限内に収める。
    const maxDurationMinutes = 320;
    const spots = [
      makeSpot({ id: "food", category: "food", durationMinutes: 60, latitude: 35.0, longitude: 139.0 }),
      makeSpot({ id: "cafe", category: "cafe", durationMinutes: 60, latitude: 35.001, longitude: 139.001 }),
      makeSpot({ id: "far", category: "nature", durationMinutes: 60, latitude: 35.3, longitude: 139.3 }),
    ];

    const plans = generatePlans(
      spots,
      { maxDurationMinutes },
      noPins,
      noBlacklist,
    );

    for (const { plan } of plans) {
      expect(plan.totalStayMinutes + plan.totalTravelMinutes).toBeLessThanOrEqual(
        maxDurationMinutes,
      );
      expect(plan.durationExceeded).toBe(false);
    }
  });

  it("飲食系（食事・カフェ）を連続させない", () => {
    // 同一座標（移動差なし）。間に挟める非飲食スポットを十分用意する。
    const food = makeSpot({ id: "food", category: "food" });
    const cafe = makeSpot({ id: "cafe", category: "cafe" });
    const nature = Array.from({ length: 6 }, (_, i) =>
      makeSpot({ id: `n${i}`, category: "nature" }),
    );
    const spots = [food, cafe, ...nature];

    const plans = generatePlans(spots, {}, noPins, noBlacklist);
    const isMeal = (category: string) =>
      category === "food" || category === "cafe";

    for (const { plan } of plans) {
      for (let i = 1; i < plan.spots.length; i += 1) {
        const consecutiveMeal =
          isMeal(plan.spots[i].category) && isMeal(plan.spots[i - 1].category);
        expect(consecutiveMeal).toBe(false);
      }
    }
  });

  it("飲食系（食事・カフェ）同士は 1km 以上離す", () => {
    // 食事 2 件・カフェ 2 件を 1km 未満の至近距離に密集させ、ほかは離す。
    // 制約がなければ食重視は密集した飲食系を複数採用してしまう。
    const closeMeals = [
      makeSpot({ id: "food-a", category: "food", latitude: 35.0, longitude: 139.0 }),
      makeSpot({ id: "food-b", category: "food", latitude: 35.002, longitude: 139.002 }),
      makeSpot({ id: "cafe-a", category: "cafe", latitude: 35.001, longitude: 139.001 }),
      makeSpot({ id: "cafe-b", category: "cafe", latitude: 35.003, longitude: 139.0 }),
    ];
    // 間を埋める非飲食スポット。
    const nature = Array.from({ length: 6 }, (_, i) =>
      makeSpot({ id: `n${i}`, category: "nature", latitude: 35.1 + i * 0.02 }),
    );
    const spots = [...closeMeals, ...nature];

    const plans = generatePlans(spots, {}, noPins, noBlacklist);
    const isMeal = (category: string) =>
      category === "food" || category === "cafe";

    for (const { plan } of plans) {
      const meals = plan.spots.filter((s) => isMeal(s.category));
      for (let i = 0; i < meals.length; i += 1) {
        for (let j = i + 1; j < meals.length; j += 1) {
          expect(calculateDistanceKm(meals[i], meals[j])).toBeGreaterThanOrEqual(
            1,
          );
        }
      }
    }
  });
});
