import * as Sentry from "@sentry/react-router";
import { logger } from "~/server/observability/logger";

const PLACE_DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";
const RESOLVE_NAMES_ENDPOINT =
  "https://mapstools.googleapis.com/v1alpha:resolveNames";
const RESOLVE_NAMES_BATCH_SIZE = 20;

/**
 * Google Places API の認証キー。Places 用が無ければ Maps 用にフォールバックする。
 */
export function getPlacesApiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
}

type ResolveNamesResponse = {
  results?: Array<{
    entity?: { place?: string };
    confidence?: string;
  }>;
  failedRequests?: Record<string, { code?: number; message?: string }>;
};

function extractPlaceId(resourceName: string | undefined): string | null {
  if (!resourceName) return null;
  return resourceName.startsWith("places/")
    ? resourceName.slice("places/".length)
    : resourceName;
}

async function resolveNamesChunk(
  texts: string[],
  apiKey: string,
): Promise<Array<string | null>> {
  const response = await fetch(RESOLVE_NAMES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify({
      queries: texts.map((text) => ({ text })),
      regionCode: "JP",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("places.resolve", "resolveNames failed", undefined, {
      status: response.status,
      body,
    });
    return texts.map(() => null);
  }

  const data = (await response.json()) as ResolveNamesResponse;
  const results = data.results ?? [];
  if (data.failedRequests && Object.keys(data.failedRequests).length > 0) {
    logger.warn("places.resolve", "resolveNames partial failures", {
      failedRequests: data.failedRequests,
    });
  }
  return texts.map((_, i) => extractPlaceId(results[i]?.entity?.place));
}

/**
 * Resolution API (Grounding Lite) でテキスト→PlaceID をバッチ解決する。
 * 最大20件/リクエストで自動チャンク分割。失敗要素は null で埋める。
 */
export async function resolvePlaceIdsByNames(
  texts: string[],
  apiKey: string,
): Promise<Array<string | null>> {
  if (texts.length === 0) return [];

  return Sentry.startSpan(
    {
      name: "places.resolvePlaceIdsByNames",
      op: "places.resolve",
      attributes: {
        "places.resolve.input_count": texts.length,
        "places.resolve.chunk_size": RESOLVE_NAMES_BATCH_SIZE,
      },
    },
    async () => {
      const results: Array<string | null> = [];
      for (let i = 0; i < texts.length; i += RESOLVE_NAMES_BATCH_SIZE) {
        const chunk = texts.slice(i, i + RESOLVE_NAMES_BATCH_SIZE);
        const chunkResults = await resolveNamesChunk(chunk, apiKey);
        results.push(...chunkResults);
      }
      return results;
    },
  );
}

/**
 * Place ID から写真リソース名を取得する。失敗時は null。
 */
export async function fetchPlacePhotoNamesByPlaceId(
  placeId: string,
  apiKey: string,
  maxPhotos: number,
): Promise<string[] | null> {
  const response = await fetch(`${PLACE_DETAILS_ENDPOINT}/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "photos",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("places.photo", "place details failed", undefined, {
      status: response.status,
      body,
      placeId,
    });
    return null;
  }

  const data = (await response.json()) as {
    photos?: Array<{ name: string }>;
  };
  const photos = data.photos?.slice(0, maxPhotos) ?? [];
  return photos.map((p) => p.name);
}


/**
 * 写真リソース名から実際の画像 URI を取得する。失敗時は null。
 */
export async function fetchPhotoMediaUri(
  photoName: string,
  apiKey: string,
): Promise<string | null> {
  const mediaUrl = new URL(
    `https://places.googleapis.com/v1/${photoName}/media`,
  );
  mediaUrl.searchParams.set("maxWidthPx", "800");
  mediaUrl.searchParams.set("maxHeightPx", "600");
  mediaUrl.searchParams.set("skipHttpRedirect", "true");

  try {
    const response = await fetch(mediaUrl, {
      headers: { "X-Goog-Api-Key": apiKey },
    });
    if (!response.ok) {
      const body = await response.text();
      logger.error("places.photo", "media fetch failed", undefined, {
        status: response.status,
        body,
      });
      return null;
    }
    const data = (await response.json()) as { photoUri?: string };
    return data.photoUri ?? null;
  } catch (error) {
    logger.error("places.photo", "media fetch error", error);
    return null;
  }
}
