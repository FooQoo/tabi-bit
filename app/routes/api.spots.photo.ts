import type { Route } from "./+types/api.spots.photo";
import { getPlacesApiKey } from "~/server/repositories/google-places";
import { resolveSpotPhotos } from "~/server/services/spot-photo";

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
  const name = url.searchParams.get("name")?.trim();
  const area = url.searchParams.get("area")?.trim() ?? "";
  const placeId = url.searchParams.get("placeId")?.trim() || undefined;

  if (!name) {
    return jsonResponse([], 60);
  }

  try {
    const { photoUrls, cacheSeconds } = await resolveSpotPhotos({
      name,
      area,
      apiKey,
      placeId,
    });
    return jsonResponse(photoUrls, cacheSeconds);
  } catch (error) {
    console.error("[places/photo] unexpected error:", error);
    return jsonResponse([], 60);
  }
}
