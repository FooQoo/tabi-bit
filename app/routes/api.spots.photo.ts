import type { Route } from "./+types/api.spots.photo";

type PhotoResult = {
  photoUrls: string[];
};

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const MAX_PHOTOS = 5;

function jsonResponse(result: PhotoResult, cacheSeconds: number) {
  return new Response(JSON.stringify(result), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
    },
  });
}

async function fetchPhotoUri(
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
      console.error(`[places/photo] media fetch failed (${response.status}):`, body);
      return null;
    }
    const data = (await response.json()) as { photoUri?: string };
    return data.photoUri ?? null;
  } catch (error) {
    console.error("[places/photo] media fetch error:", error);
    return null;
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return jsonResponse({ photoUrls: [] }, 60);
  }

  const url = new URL(request.url);
  const name = url.searchParams.get("name")?.trim();
  const area = url.searchParams.get("area")?.trim() ?? "";

  if (!name) {
    return jsonResponse({ photoUrls: [] }, 60);
  }

  const textQuery = `${name} ${area}`.trim();

  try {
    const searchResponse = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.photos",
      },
      body: JSON.stringify({
        textQuery,
        languageCode: "ja",
        regionCode: "JP",
        maxResultCount: 1,
      }),
    });

    if (!searchResponse.ok) {
      const body = await searchResponse.text();
      console.error(`[places/photo] searchText failed (${searchResponse.status}):`, body);
      return jsonResponse({ photoUrls: [] }, 300);
    }

    const searchData = (await searchResponse.json()) as {
      places?: Array<{
        photos?: Array<{ name: string }>;
      }>;
    };

    const photos = searchData.places?.[0]?.photos?.slice(0, MAX_PHOTOS) ?? [];
    if (photos.length === 0) {
      console.log(`[places/photo] no photos found for: ${textQuery}`);
      return jsonResponse({ photoUrls: [] }, 86_400);
    }

    const uris = await Promise.all(
      photos.map((photo) => fetchPhotoUri(photo.name, apiKey)),
    );
    const photoUrls = uris.filter((uri): uri is string => uri !== null);
    console.log(`[places/photo] "${textQuery}" → ${photoUrls.length}/${photos.length} photos`);

    return jsonResponse({ photoUrls }, photoUrls.length > 0 ? 86_400 : 300);
  } catch (error) {
    console.error("[places/photo] unexpected error:", error);
    return jsonResponse({ photoUrls: [] }, 60);
  }
}
