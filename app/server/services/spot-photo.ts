import {
  fetchPhotoMediaUri,
  fetchPlacePhotoNamesByPlaceId,
} from "~/server/repositories/google-places";

const MAX_PHOTOS = 1;

export type PhotoResolution = {
  photoUrls: string[];
  cacheSeconds: number;
};

/**
 * Place ID から写真 URL を解決する。
 */
export async function resolveSpotPhotos({
  apiKey,
  placeId,
}: {
  apiKey: string;
  placeId: string;
}): Promise<PhotoResolution> {
  const photoNames = await fetchPlacePhotoNamesByPlaceId(
    placeId,
    apiKey,
    MAX_PHOTOS,
  );

  if (photoNames === null) {
    return { photoUrls: [], cacheSeconds: 300 };
  }

  if (photoNames.length === 0) {
    console.log(`[places/photo] no photos found for placeId: ${placeId}`);
    return { photoUrls: [], cacheSeconds: 86_400 };
  }

  const uris = await Promise.all(
    photoNames.map((photoName) => fetchPhotoMediaUri(photoName, apiKey)),
  );
  const photoUrls = uris.filter((uri): uri is string => uri !== null);
  console.log(
    `[places/photo] placeId=${placeId} → ${photoUrls.length}/${photoNames.length} photos`,
  );

  return {
    photoUrls,
    cacheSeconds: photoUrls.length > 0 ? 86_400 : 300,
  };
}
