import { describe, expect, it } from "vitest";

import {
  calculateDistanceKm,
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
