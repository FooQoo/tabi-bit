// 日本周辺の「陸/海」ビットマスクを生成し、app/domain/geo/japan-land-mask.ts を出力する。
//
// Natural Earth 10m の陸地ポリゴンを取得し、日本 bbox にクリップして格子状に
// ラスタライズする。各セル中心が陸地なら 1、海なら 0 のビットを立て、MSB 先頭で
// バイトにパックして base64 文字列として書き出す。
//
// 実行（取得に一度だけネットワークが必要。生成物 .ts はコミットしランタイムは完全オフライン）:
//   node scripts/build-japan-land-mask.mjs
//
// 解像度・範囲を変えたいときは下の定数を調整して再実行する。

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// --- 設定 -----------------------------------------------------------------

/** 日本 bbox（主要列島をカバー。これより外は陸扱い＝ペナルティなしで運用）。 */
const MIN_LAT = 24;
const MAX_LAT = 46;
const MIN_LON = 122;
const MAX_LON = 146;

/** 格子セルの一辺（度）。0.025° ≈ 2km。 */
const CELL_DEG = 0.025;

/** Natural Earth 10m 陸地（public domain）。 */
const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../app/domain/geo/japan-land-mask.ts");

// --- ジオメトリ --------------------------------------------------------------

/** 1 つのリング（[lon, lat][]）の bbox を求める。 */
function ringBounds(ring) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** リング（[lon, lat][]）内に点があるか（even-odd ray casting）。 */
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * GeoJSON の Polygon / MultiPolygon を「ポリゴン（リング配列）」の配列に正規化する。
 * Polygon = [outer, hole...]、MultiPolygon = [[outer, hole...], ...]。
 */
function collectPolygons(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

// --- メイン ----------------------------------------------------------------

async function main() {
  console.log(`fetching ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const geojson = await res.json();

  // 日本 bbox に重なるポリゴンだけ集める。各ポリゴンはリングごとに bbox を前計算。
  const polygons = [];
  for (const feature of geojson.features ?? []) {
    for (const rings of collectPolygons(feature.geometry)) {
      const ringsWithBounds = rings.map((ring) => ({
        ring,
        bounds: ringBounds(ring),
      }));
      const outer = ringsWithBounds[0]?.bounds;
      if (!outer) continue;
      // 外周 bbox が日本 bbox と重ならないポリゴンはスキップ。
      const overlaps =
        outer.maxLon >= MIN_LON &&
        outer.minLon <= MAX_LON &&
        outer.maxLat >= MIN_LAT &&
        outer.minLat <= MAX_LAT;
      if (overlaps) polygons.push(ringsWithBounds);
    }
  }
  console.log(`japan-overlapping polygons: ${polygons.length}`);

  const rows = Math.round((MAX_LAT - MIN_LAT) / CELL_DEG);
  const cols = Math.round((MAX_LON - MIN_LON) / CELL_DEG);
  const total = rows * cols;
  const bytes = new Uint8Array(Math.ceil(total / 8));
  console.log(`grid: ${rows} rows x ${cols} cols = ${total} cells`);

  /** 点が陸地か（even-odd をポリゴン単位で評価し、いずれかで内側なら陸）。 */
  function isLandPoint(lon, lat) {
    for (const rings of polygons) {
      let inside = false;
      for (const { ring, bounds } of rings) {
        if (
          lon < bounds.minLon ||
          lon > bounds.maxLon ||
          lat < bounds.minLat ||
          lat > bounds.maxLat
        ) {
          continue;
        }
        if (pointInRing(lon, lat, ring)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  // 行は南（MIN_LAT）→ 北、列は西（MIN_LON）→ 東。index = r*cols + c。
  let landCount = 0;
  for (let r = 0; r < rows; r += 1) {
    const lat = MIN_LAT + (r + 0.5) * CELL_DEG;
    for (let c = 0; c < cols; c += 1) {
      const lon = MIN_LON + (c + 0.5) * CELL_DEG;
      if (isLandPoint(lon, lat)) {
        const index = r * cols + c;
        bytes[index >> 3] |= 0x80 >> (index & 7);
        landCount += 1;
      }
    }
    if (r % 100 === 0) console.log(`  row ${r}/${rows}`);
  }
  console.log(`land cells: ${landCount} (${((landCount / total) * 100).toFixed(1)}%)`);

  const base64 = Buffer.from(bytes).toString("base64");
  const file = `// 自動生成ファイル — 手で編集しない。
// 生成元: scripts/build-japan-land-mask.mjs（Natural Earth 10m 陸地, public domain）。
// 日本周辺の陸/海ビットマスク。1 bit/セル、MSB 先頭、行=南→北・列=西→東、index = row*cols + col。

export const JAPAN_LAND_MASK = {
  /** 格子原点（南西端）と 1 セルの大きさ（度）。 */
  minLat: ${MIN_LAT},
  minLon: ${MIN_LON},
  cellDeg: ${CELL_DEG},
  rows: ${rows},
  cols: ${cols},
  /** base64 でパックしたビットマスク（1=陸, 0=海）。 */
  data: "${base64}",
} as const;
`;

  await writeFile(OUT_PATH, file, "utf8");
  console.log(`wrote ${OUT_PATH} (base64 ${base64.length} chars)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
