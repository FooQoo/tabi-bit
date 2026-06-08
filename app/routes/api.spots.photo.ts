import type { Route } from "./+types/api.spots.photo";
import { getPlacesApiKey } from "~/server/repositories/google-places";
import { resolveSpotPhotos } from "~/server/services/spot-photo";
import { logger } from "~/server/observability/logger";

function jsonResponse(photoUrls: string[], cacheSeconds: number) {
  return new Response(JSON.stringify({ photoUrls }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
    },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const apiKey = getPlacesApiKey();

  if (!apiKey) {
    return jsonResponse([], 60);
  }

  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId")?.trim();

  if (!placeId) {
    return jsonResponse([], 60);
  }

  try {
    const { photoUrls, cacheSeconds } = await resolveSpotPhotos({
      apiKey,
      placeId,
    });
    return jsonResponse(photoUrls, cacheSeconds);
  } catch (error) {
    logger.error("places.photo", "unexpected error", error, { placeId });
    return jsonResponse([], 60);
  }
}
