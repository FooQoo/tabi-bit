import {
  fetchPhotoMediaUri,
  searchPlacePhotoNames,
} from "~/server/repositories/google-places";

const MAX_PHOTOS = 5;

export type PhotoResolution = {
  photoUrls: string[];
  /** この結果をどれだけキャッシュしてよいかの目安（秒）。 */
  cacheSeconds: number;
};

/**
 * スポット名・エリアから写真 URL 群を解決する。
 * 結果の安定度に応じてキャッシュ秒数を返す:
 * - 検索失敗 / 一部取得失敗: 300 秒（短期、再試行余地あり）
 * - 写真が存在しない: 86400 秒（安定）
 * - 写真取得成功: 86400 秒
 */
export async function resolveSpotPhotos({
  name,
  area,
  apiKey,
}: {
  name: string;
  area: string;
  apiKey: string;
}): Promise<PhotoResolution> {
  const textQuery = `${name} ${area}`.trim();

  const photoNames = await searchPlacePhotoNames(textQuery, apiKey, MAX_PHOTOS);

  if (photoNames === null) {
    return { photoUrls: [], cacheSeconds: 300 };
  }

  if (photoNames.length === 0) {
    console.log(`[places/photo] no photos found for: ${textQuery}`);
    return { photoUrls: [], cacheSeconds: 86_400 };
  }

  const uris = await Promise.all(
    photoNames.map((photoName) => fetchPhotoMediaUri(photoName, apiKey)),
  );
  const photoUrls = uris.filter((uri): uri is string => uri !== null);
  console.log(
    `[places/photo] "${textQuery}" → ${photoUrls.length}/${photoNames.length} photos`,
  );

  return {
    photoUrls,
    cacheSeconds: photoUrls.length > 0 ? 86_400 : 300,
  };
}
