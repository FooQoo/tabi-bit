import type { GeneratedSpot } from "~/domain/spot/spot";
import type { TravelLeg, TravelMode } from "~/domain/plan/plan";

export function buildTravelLegs(spots: GeneratedSpot[]) {
  return spots.slice(1).map((spot, index) => {
    const previousSpot = spots[index];
    return estimateTravel(previousSpot, spot);
  });
}

export function estimateTravel(
  fromSpot: GeneratedSpot,
  toSpot: GeneratedSpot,
): TravelLeg {
  const distanceKm = calculateDistanceKm(fromSpot, toSpot);
  const isTokyo = fromSpot.prefecture === "東京都";

  let minutes: number;
  let mode: TravelMode;

  if (isTokyo) {
    if (distanceKm <= 1.0) {
      // 徒歩: 4.5 km/h、道のり係数 1.2
      mode = "walk";
      minutes = Math.max(5, Math.ceil(((distanceKm * 1.2) / 4.5) * 60));
    } else {
      // 電車: 駅までの歩き + 待ち時間の固定オーバーヘッド 10分
      // 実効速度 30 km/h（停車・乗り換え込み）、道のり係数 1.3
      mode = "train";
      minutes = Math.max(12, 10 + Math.ceil(((distanceKm * 1.3) / 30) * 60));
    }
  } else {
    // 車: 固定オーバーヘッド 5分（乗降・駐車）+ 距離に応じた速度
    // 短距離: 25 km/h（生活道路）/ 中距離: 40 km/h（幹線道路）/ 長距離: 60 km/h（幹線〜高速）
    mode = "car";
    const routeKm = distanceKm * 1.3;
    const travelMin =
      distanceKm <= 3
        ? Math.ceil((routeKm / 25) * 60)
        : distanceKm <= 15
          ? Math.ceil((routeKm / 40) * 60)
          : Math.ceil((routeKm / 60) * 60);
    minutes = Math.max(5, 5 + travelMin);
  }

  return {
    fromSpotId: fromSpot.id,
    toSpotId: toSpot.id,
    distanceKm,
    minutes,
    mode,
  };
}

function calculateDistanceKm(fromSpot: GeneratedSpot, toSpot: GeneratedSpot) {
  const earthRadiusKm = 6371;
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
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}
