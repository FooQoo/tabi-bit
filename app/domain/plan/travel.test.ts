import { describe, expect, it } from "vitest";

import {
  calculateDistanceKm,
  clearTravelCache,
  decideTravelMode,
  estimateTravel,
  routeTravelMinutes,
} from "~/domain/plan/travel";
import { makeSpot } from "~/domain/plan/__fixtures__/spot";

describe("decideTravelMode", () => {
  it("短距離はどの府県でも徒歩", () => {
    expect(decideTravelMode("東京都", 0.5)).toBe("walk");
    expect(decideTravelMode("北海道", 0.5)).toBe("walk");
  });

  it("鉄道主要府県では中距離は電車", () => {
    expect(decideTravelMode("東京都", 5)).toBe("train");
    expect(decideTravelMode("大阪府", 5)).toBe("train");
  });

  it("鉄道主要府県以外では中距離は車", () => {
    expect(decideTravelMode("北海道", 5)).toBe("car");
    expect(decideTravelMode("長野県", 5)).toBe("car");
  });

  it("東京でも長距離は電車のまま（車固定ではない）", () => {
    expect(decideTravelMode("東京都", 40)).toBe("train");
  });
});

describe("calculateDistanceKm", () => {
  it("同一座標の距離は 0", () => {
    const spot = makeSpot({ latitude: 35.68, longitude: 139.76 });
    expect(calculateDistanceKm(spot, spot)).toBeCloseTo(0, 5);
  });

  it("東京駅〜新宿駅は概ね 6km 前後", () => {
    const tokyo = makeSpot({ latitude: 35.681, longitude: 139.767 });
    const shinjuku = makeSpot({ latitude: 35.69, longitude: 139.7 });
    const distance = calculateDistanceKm(tokyo, shinjuku);
    expect(distance).toBeGreaterThan(5);
    expect(distance).toBeLessThan(7);
  });
});

describe("estimateTravel", () => {
  it("近接スポットは徒歩で最小 5 分", () => {
    const a = makeSpot({ latitude: 35.0, longitude: 139.0 });
    const b = makeSpot({ latitude: 35.0009, longitude: 139.0 });
    const leg = estimateTravel(a, b);
    expect(leg.mode).toBe("walk");
    expect(leg.minutes).toBe(5);
  });

  it("from/to の id を記録する", () => {
    const a = makeSpot({ id: "a" });
    const b = makeSpot({ id: "b" });
    const leg = estimateTravel(a, b);
    expect(leg.fromSpotId).toBe("a");
    expect(leg.toSpotId).toBe("b");
  });

  it("陸上のみのレグは crossesWater=false", () => {
    const tokyo = makeSpot({ latitude: 35.681, longitude: 139.767 });
    const shinjuku = makeSpot({ latitude: 35.69, longitude: 139.7 });
    expect(estimateTravel(tokyo, shinjuku).crossesWater).toBe(false);
  });

  it("海を渡るレグは crossesWater=true で、同距離の陸上レグより所要時間が長い", () => {
    // 横浜〜千葉（東京湾を横断）。
    const yokohama = makeSpot({ latitude: 35.44, longitude: 139.64 });
    const chiba = makeSpot({ latitude: 35.61, longitude: 140.11 });
    const overWater = estimateTravel(yokohama, chiba);

    // ほぼ同じ直線距離だが陸上で完結する対照レグ（埼玉内陸へ北上）。
    const inland = estimateTravel(
      makeSpot({ latitude: 35.9, longitude: 139.6 }),
      makeSpot({ latitude: 35.86, longitude: 140.07 }),
    );

    expect(overWater.crossesWater).toBe(true);
    expect(inland.crossesWater).toBe(false);
    expect(overWater.minutes).toBeGreaterThan(inland.minutes);
  });
});

describe("routeTravelMinutes", () => {
  it("各レグの合計を返す", () => {
    const spots = [
      makeSpot({ latitude: 35.0, longitude: 139.0 }),
      makeSpot({ latitude: 35.2, longitude: 139.0 }),
      makeSpot({ latitude: 35.4, longitude: 139.0 }),
    ];
    const total = routeTravelMinutes(spots);
    const manual =
      estimateTravel(spots[0], spots[1]).minutes +
      estimateTravel(spots[1], spots[2]).minutes;
    expect(total).toBe(manual);
  });

  it("1 件以下なら 0", () => {
    expect(routeTravelMinutes([])).toBe(0);
    expect(routeTravelMinutes([makeSpot()])).toBe(0);
  });
});

describe("estimateTravel のメモ化", () => {
  it("キャッシュの有無で結果が変わらない", () => {
    const a = makeSpot({ id: "ca", latitude: 35.0, longitude: 139.0 });
    const b = makeSpot({ id: "cb", latitude: 35.3, longitude: 139.2 });

    clearTravelCache();
    const fresh = estimateTravel(a, b);
    const cached = estimateTravel(a, b); // 2 回目はキャッシュ
    expect(cached).toEqual(fresh);

    clearTravelCache();
    const afterClear = estimateTravel(a, b);
    expect(afterClear).toEqual(fresh);
  });
});
