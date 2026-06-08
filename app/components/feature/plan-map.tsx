import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

import type { TravelLeg } from "~/domain/plan/plan";
import type { GeneratedSpot } from "~/domain/spot/spot";

type LatLng = [number, number];

/**
 * プランのスポットを OpenStreetMap 上に番号付きで表示し、
 * OSRM で道路に沿った経路を引くクライアント専用の地図。
 * Leaflet は window 依存なので useEffect 内で動的に読み込む。
 */
export function PlanMap({
  spots,
  travelLegs,
}: {
  spots: GeneratedSpot[];
  travelLegs: TravelLeg[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // 依存配列を安定させるための座標シグネチャ。
  const signature = spots.map((s) => s.id).join(",");

  useEffect(() => {
    if (spots.length === 0 || !containerRef.current) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !containerRef.current) return;

        const points: LatLng[] = spots.map((s) => [s.latitude, s.longitude]);

        const container = containerRef.current;
        const map = L.map(container, {
          // 通常スクロールはページに通す。ズームはピンチ（下で ctrl+wheel を処理）と
          // タッチのピンチ（touchZoom）、ズームボタンに任せる。
          scrollWheelZoom: false,
          touchZoom: true,
          // ピンチを連続ズームにする（既定の整数スナップだとカクつく）。
          zoomSnap: 0,
          attributionControl: true,
        });

        // Mac トラックパッド等のピンチは ctrl+wheel として届く。
        // ctrl のときだけズームし、素のスクロールはページに通す。
        const onWheel = (event: WheelEvent) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          const point = map.mouseEventToContainerPoint(event);
          const nextZoom = map.getZoom() - event.deltaY * 0.01;
          map.setZoomAround(
            map.containerPointToLatLng(point),
            nextZoom,
            { animate: false },
          );
        };
        container.addEventListener("wheel", onWheel, { passive: false });

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        // 番号付きマーカー。本来座標は別に保持し、被り解消で本来位置から再計算する。
        const trueLatLngs = points.map(([lat, lng]) => L.latLng(lat, lng));
        const markers = points.map(([lat, lng], index) => {
          const icon = L.divIcon({
            className: "",
            html: `<span style="display:flex;width:1.75rem;height:1.75rem;align-items:center;justify-content:center;border-radius:9999px;background:var(--primary,#0f172a);color:var(--primary-foreground,#fff);font-size:0.8rem;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,0.35);border:2px solid #fff;">${index + 1}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });
          return L.marker([lat, lng], {
            icon,
            title: spots[index].name,
            zIndexOffset: index,
          })
            .addTo(map)
            .bindPopup(`${index + 1}. ${spots[index].name}`);
        });

        // 被ったマーカーだけ本来位置の周りに扇状へずらし、引き出し線を結ぶ。
        // ズーム（ピクセル距離）が変わるたびに本来位置から再計算する。
        const declutter = declutterFactory(L, map, markers, trueLatLngs);
        map.on("zoomend", declutter);

        map.fitBounds(L.latLngBounds(points), {
          padding: [32, 32],
          animate: false,
        });
        declutter();

        // 直線をまず引いておき、経路取得に成功したら差し替える。
        const fallbackLine = L.polyline(points, {
          color: "var(--primary, #0f172a)",
          weight: 3,
          opacity: 0.5,
          dashArray: "6 6",
        }).addTo(map);

        cleanup = () => {
          container.removeEventListener("wheel", onWheel);
          map.remove();
        };

        // OSRM で道路沿いの経路を取得（2 地点以上のときのみ）。
        if (points.length >= 2) {
          const route = await fetchRoute(points);
          if (!cancelled && route && route.length > 0) {
            fallbackLine.remove();
            L.polyline(route, {
              color: "var(--primary, #0f172a)",
              weight: 4,
              opacity: 0.85,
            }).addTo(map);
          }
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // travelLegs はマーカー表示に影響しないため signature のみで再構築する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (spots.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        プランのMap
      </span>
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-lg border bg-muted"
        role="img"
        aria-label="プランの地図"
      />
      {failed && (
        <p className="text-xs text-muted-foreground">
          地図を読み込めませんでした。
        </p>
      )}
    </div>
  );
}

/** マーカーの中心がこの px 以内に近づいたら被りとみなして扇状にちらす。 */
const COLLISION_PX = 32;

/**
 * 近接して被るマーカーだけを本来位置の周りに扇状へ退避させる関数を作る。
 * 単独マーカーは本来位置に戻す。被ったマーカーには本来位置への引き出し線を引く。
 * 退避量はピクセル基準なので、ズームのたびに本来位置から計算し直す。
 */
function declutterFactory(
  L: typeof import("leaflet"),
  map: import("leaflet").Map,
  markers: import("leaflet").Marker[],
  trueLatLngs: import("leaflet").LatLng[],
) {
  let connectors: import("leaflet").Polyline[] = [];

  return function declutter() {
    connectors.forEach((line) => line.remove());
    connectors = [];

    const points = trueLatLngs.map((ll) => map.latLngToLayerPoint(ll));
    const used = new Array(markers.length).fill(false);

    for (let i = 0; i < markers.length; i += 1) {
      if (used[i]) continue;
      const group = [i];
      used[i] = true;
      for (let j = i + 1; j < markers.length; j += 1) {
        if (!used[j] && points[i].distanceTo(points[j]) < COLLISION_PX) {
          group.push(j);
          used[j] = true;
        }
      }

      if (group.length === 1) {
        markers[i].setLatLng(trueLatLngs[i]);
        continue;
      }

      // グループ重心の周りに等角で配置する。半径は互いが重ならない最小値。
      const cx = group.reduce((sum, k) => sum + points[k].x, 0) / group.length;
      const cy = group.reduce((sum, k) => sum + points[k].y, 0) / group.length;
      const radius = Math.max(
        COLLISION_PX * 0.7,
        COLLISION_PX / 2 / Math.sin(Math.PI / group.length),
      );

      group.forEach((k, idx) => {
        const angle = (2 * Math.PI * idx) / group.length - Math.PI / 2;
        const offset = L.point(
          cx + Math.cos(angle) * radius,
          cy + Math.sin(angle) * radius,
        );
        const offsetLatLng = map.layerPointToLatLng(offset);
        markers[k].setLatLng(offsetLatLng);
        connectors.push(
          L.polyline([trueLatLngs[k], offsetLatLng], {
            color: "var(--primary, #0f172a)",
            weight: 1,
            opacity: 0.4,
          }).addTo(map),
        );
      });
    }
  };
}

/** OSRM 公開サーバーで道路に沿った経路を取得する。失敗時は null。 */
async function fetchRoute(points: LatLng[]): Promise<LatLng[] | null> {
  try {
    const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>;
    };
    const line = data.routes?.[0]?.geometry?.coordinates;
    if (!line) return null;
    // GeoJSON は [lng, lat] なので [lat, lng] に変換する。
    return line.map(([lng, lat]) => [lat, lng] as LatLng);
  } catch {
    return null;
  }
}
