import type { GeneratedSpot } from "~/domain/spot/spot";

let counter = 0;

/** テスト用のスポットを生成する。指定しないフィールドは無難な既定値。 */
export function makeSpot(overrides: Partial<GeneratedSpot> = {}): GeneratedSpot {
  counter += 1;
  return {
    id: `spot-${counter}`,
    name: `spot-${counter}`,
    description: "テスト用スポット",
    highlights: ["highlight"],
    detourLevel: 1,
    latitude: 35.0,
    longitude: 139.0,
    durationMinutes: 60,
    budgetYen: { min: 0, max: 0 },
    category: "nature",
    country: "Japan",
    prefecture: "東京都",
    ...overrides,
  };
}
