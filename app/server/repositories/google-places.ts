const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

/**
 * Google Places API の認証キー。Places 用が無ければ Maps 用にフォールバックする。
 */
export function getPlacesApiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
}

/**
 * テキスト検索で先頭の場所の Place ID を返す。失敗時は null。
 */
export async function searchPlaceId(
  textQuery: string,
  apiKey: string,
): Promise<string | null> {
  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "ja",
      regionCode: "JP",
      maxResultCount: 1,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(
      `[places/resolve] searchText failed (${response.status}):`,
      body,
    );
    return null;
  }

  const data = (await response.json()) as {
    places?: Array<{ id: string }>;
  };
  return data.places?.[0]?.id ?? null;
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
    console.error(
      `[places/photo] place details failed (${response.status}):`,
      body,
    );
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
      console.error(
        `[places/photo] media fetch failed (${response.status}):`,
        body,
      );
      return null;
    }
    const data = (await response.json()) as { photoUri?: string };
    return data.photoUri ?? null;
  } catch (error) {
    console.error("[places/photo] media fetch error:", error);
    return null;
  }
}
