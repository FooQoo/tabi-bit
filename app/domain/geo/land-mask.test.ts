import { describe, expect, it } from "vitest";

import { isLand, waterCrossingFraction } from "~/domain/geo/land-mask";

describe("isLand", () => {
  it("市街地は陸", () => {
    expect(isLand(35.681, 139.767)).toBe(true); // 東京駅
    expect(isLand(34.702, 135.495)).toBe(true); // 大阪駅
    expect(isLand(43.068, 141.351)).toBe(true); // 札幌駅
  });

  it("東京湾・外洋は海", () => {
    expect(isLand(35.5, 139.85)).toBe(false); // 東京湾中央付近
    expect(isLand(34.0, 141.0)).toBe(false); // 房総沖の太平洋
  });

  it("bbox 外は陸扱い（ペナルティを与えない保守側）", () => {
    expect(isLand(10, 130)).toBe(true);
    expect(isLand(35, 160)).toBe(true);
  });
});

describe("waterCrossingFraction", () => {
  it("近接する陸上 2 点は海を渡らない", () => {
    // 東京駅〜新宿駅
    expect(waterCrossingFraction(35.681, 139.767, 35.69, 139.7)).toBe(0);
  });

  it("東京湾を挟む対岸（横浜〜千葉）は海を渡る", () => {
    expect(
      waterCrossingFraction(35.44, 139.64, 35.61, 140.11),
    ).toBeGreaterThan(0);
  });

  it("松島湾の短距離レグ（塩竈〜桂島）も海を渡る", () => {
    expect(
      waterCrossingFraction(38.315, 141.022, 38.329, 141.106),
    ).toBeGreaterThan(0);
  });

  it("本州〜北海道（津軽海峡越え）は海を渡る", () => {
    // 青森〜函館
    expect(
      waterCrossingFraction(40.82, 140.74, 41.77, 140.73),
    ).toBeGreaterThan(0);
  });
});
