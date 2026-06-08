import {
  fetchPhotoMediaUri,
  fetchPlacePhotoNamesByPlaceId,
  searchPlacePhotoNames,
} from "~/server/repositories/google-places";

const MAX_PHOTOS = 1;

export type PhotoResolution = {
  photoUrls: string[];
  /** この結果をどれだけキャッシュしてよいかの目安（秒）。 */
  cacheSeconds: number;
};

/**
 * スポット名・エリアから写真 URL 群を解決する。
 * placeId が指定された場合はテキスト検索をスキップして Place ID で直接取得する。
 */
export async function resolveSpotPhotos({
  name,
  area,
  apiKey,
  placeId,
}: {
  name: string;
  area: string;
  apiKey: string;
  placeId?: string;
}): Promise<PhotoResolution> {
  const photoNames = placeId
    ? await fetchPlacePhotoNamesByPlaceId(placeId, apiKey, MAX_PHOTOS)
    : await searchPlacePhotoNames(`${name} ${area}`.trim(), apiKey, MAX_PHOTOS);

  if (photoNames === null) {
    return { photoUrls: [], cacheSeconds: 300 };
  }

  if (photoNames.length === 0) {
    console.log(
      `[places/photo] no photos found for: ${placeId ?? `${name} ${area}`.trim()}`,
    );
    return { photoUrls: [], cacheSeconds: 86_400 };
  }

  const uris = await Promise.all(
    photoNames.map((photoName) => fetchPhotoMediaUri(photoName, apiKey)),
  );
  const photoUrls = uris.filter((uri): uri is string => uri !== null);
  console.log(
    `[places/photo] "${placeId ?? name}" → ${photoUrls.length}/${photoNames.length} photos`,
  );

  return {
    photoUrls,
    cacheSeconds: photoUrls.length > 0 ? 86_400 : 300,
  };
}
