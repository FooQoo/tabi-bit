import { JAPAN_LAND_MASK } from "~/domain/geo/japan-land-mask";

/**
 * 日本周辺の陸/海ビットマスクを使った到達性ヘルパー。
 *
 * プランの移動コストは直線距離ベースなので、海を挟んで直線では近いだけの
 * スポットを「近い」と誤評価してしまう。ここでは 2 点間の直線が海上を通る割合を
 * 求め、移動コストに水域横断ペナルティを与えるのに使う（[[travel.ts]] から利用）。
 *
 * マスクは 1 bit/セル、MSB 先頭、行=南→北・列=西→東、index = row*cols + col。
 * bbox 外は「陸」とみなす（遠隔離島の誤検知を避ける＝ペナルティを与えない保守側）。
 */

const { minLat, minLon, cellDeg, rows, cols, data } = JAPAN_LAND_MASK;
const maxLat = minLat + rows * cellDeg;
const maxLon = minLon + cols * cellDeg;

/** base64 を 1 度だけビットセットへ展開する（クライアント同期処理のため）。 */
const bits = decodeBase64(data);

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** 指定座標が陸地か。bbox 外は陸扱い。 */
export function isLand(latitude: number, longitude: number): boolean {
  if (
    latitude < minLat ||
    latitude >= maxLat ||
    longitude < minLon ||
    longitude >= maxLon
  ) {
    return true;
  }

  const row = Math.min(rows - 1, Math.floor((latitude - minLat) / cellDeg));
  const col = Math.min(cols - 1, Math.floor((longitude - minLon) / cellDeg));
  const index = row * cols + col;
  return ((bits[index >> 3] >> (7 - (index & 7))) & 1) === 1;
}

/** サンプリング間隔（度）。セルより細かく刻まないと短い海越えを取りこぼす。 */
const SAMPLE_STEP_DEG = cellDeg / 2;

/** これ未満の区間（≒1 セル内）は海越えを論じる意味がないので 0 とする。 */
const MIN_SPAN_DEG = cellDeg * 0.5;

/**
 * 2 点を結ぶ直線のうち、海上を通るサンプルの割合（0〜1）を返す。
 *
 * 端点はスポット座標の誤差（海岸沿いだとセルが海側になりうる）を避けるため除外し、
 * 中間点を約 1/2 セル間隔でサンプリングする。短い湾・海峡を取りこぼさないよう、
 * セルより細かく刻む。区間が 1 セル未満なら 0。
 */
export function waterCrossingFraction(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const latSpan = toLatitude - fromLatitude;
  const lonSpan = toLongitude - fromLongitude;
  const spanDeg = Math.hypot(latSpan, lonSpan);
  if (spanDeg < MIN_SPAN_DEG) return 0;

  const segments = Math.max(2, Math.ceil(spanDeg / SAMPLE_STEP_DEG));
  let water = 0;
  for (let k = 1; k < segments; k += 1) {
    const t = k / segments;
    const lat = fromLatitude + latSpan * t;
    const lon = fromLongitude + lonSpan * t;
    if (!isLand(lat, lon)) water += 1;
  }
  return water / (segments - 1);
}
