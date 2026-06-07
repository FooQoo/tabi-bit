import type { GeneratedSpot } from "~/domain/spot/spot";
import type { TravelLeg, TravelMode } from "~/domain/plan/plan";

const EARTH_RADIUS_KM = 6371;

/** 短距離は手段を問わず徒歩とみなす上限（km）。 */
const WALK_MAX_KM = 1.1;

// 各手段の所要時間モデル（実効速度・道のり係数・固定オーバーヘッド・最小値）
const WALK = { speedKmh: 4.5, routeFactor: 1.2, minMinutes: 5 } as const;
const TRAIN = {
  speedKmh: 30,
  routeFactor: 1.3,
  overheadMinutes: 10,
  minMinutes: 12,
} as const;
const CAR = {
  routeFactor: 1.3,
  overheadMinutes: 5,
  minMinutes: 5,
  // 距離帯ごとの実効速度: 短距離=生活道路 / 中距離=幹線 / 長距離=幹線〜高速
  shortMaxKm: 3,
  shortSpeedKmh: 25,
  midMaxKm: 15,
  midSpeedKmh: 40,
  longSpeedKmh: 60,
} as const;

/**
 * 鉄道が移動の現実的な既定手段となる主要府県。
 * これ以外の府県では中〜長距離は車を既定とする。
 */
const RAIL_PREFECTURES = new Set<string>([
  "東京都",
  "神奈川県",
  "千葉県",
  "埼玉県",
  "大阪府",
  "京都府",
  "兵庫県",
  "愛知県",
  "福岡県",
]);

/**
 * 出発地の府県と距離から移動手段を決める。
 * - 近距離はどこでも徒歩。
 * - それ以上は鉄道主要府県なら電車、それ以外は車。
 */
export function decideTravelMode(
  fromPrefecture: string,
  distanceKm: number,
): TravelMode {
  if (distanceKm <= WALK_MAX_KM) {
    return "walk";
  }
  return RAIL_PREFECTURES.has(fromPrefecture) ? "train" : "car";
}

export function buildTravelLegs(spots: GeneratedSpot[]): TravelLeg[] {
  return spots.slice(1).map((spot, index) => {
    const previousSpot = spots[index];
    return estimateTravel(previousSpot, spot);
  });
}

/** 順路（spots の並び順）に沿った移動時間の合計（分）。 */
export function routeTravelMinutes(spots: GeneratedSpot[]): number {
  return buildTravelLegs(spots).reduce((total, leg) => total + leg.minutes, 0);
}

export function estimateTravel(
  fromSpot: GeneratedSpot,
  toSpot: GeneratedSpot,
): TravelLeg {
  const distanceKm = calculateDistanceKm(fromSpot, toSpot);
  const mode = decideTravelMode(fromSpot.prefecture, distanceKm);
  const minutes = estimateMinutes(mode, distanceKm);

  return {
    fromSpotId: fromSpot.id,
    toSpotId: toSpot.id,
    distanceKm,
    minutes,
    mode,
  };
}

function estimateMinutes(mode: TravelMode, distanceKm: number): number {
  if (mode === "walk") {
    const minutes = Math.ceil(
      ((distanceKm * WALK.routeFactor) / WALK.speedKmh) * 60,
    );
    return Math.max(WALK.minMinutes, minutes);
  }

  if (mode === "train") {
    const minutes =
      TRAIN.overheadMinutes +
      Math.ceil(((distanceKm * TRAIN.routeFactor) / TRAIN.speedKmh) * 60);
    return Math.max(TRAIN.minMinutes, minutes);
  }

  const routeKm = distanceKm * CAR.routeFactor;
  const speedKmh =
    distanceKm <= CAR.shortMaxKm
      ? CAR.shortSpeedKmh
      : distanceKm <= CAR.midMaxKm
        ? CAR.midSpeedKmh
        : CAR.longSpeedKmh;
  const minutes = CAR.overheadMinutes + Math.ceil((routeKm / speedKmh) * 60);
  return Math.max(CAR.minMinutes, minutes);
}

export function calculateDistanceKm(
  fromSpot: GeneratedSpot,
  toSpot: GeneratedSpot,
): number {
  const fromLatitude = toRadians(fromSpot.latitude);
  const toLatitude = toRadians(toSpot.latitude);
  const latitudeDelta = toRadians(toSpot.latitude - fromSpot.latitude);
  const longitudeDelta = toRadians(toSpot.longitude - fromSpot.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    EARTH_RADIUS_KM *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}
