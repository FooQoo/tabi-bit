import { getPlacesApiKey, searchPlaceId } from "~/server/repositories/google-places";

type ResolveRequest = {
  spots: Array<{ id: string; name: string; area: string }>;
};

type ResolveResult = {
  results: Array<{ id: string; placeId: string | null }>;
};

export async function action({ request }: { request: Request }) {
  const apiKey = getPlacesApiKey();

  if (!apiKey) {
    return new Response(JSON.stringify({ results: [] } satisfies ResolveResult), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const body = (await request.json()) as ResolveRequest;
  const spots = body.spots ?? [];

  const results = await Promise.all(
    spots.map(async (spot) => {
      const textQuery = `${spot.name} ${spot.area}`.trim();
      try {
        const placeId = await searchPlaceId(textQuery, apiKey);
        return { id: spot.id, placeId };
      } catch {
        return { id: spot.id, placeId: null };
      }
    }),
  );

  return new Response(JSON.stringify({ results } satisfies ResolveResult), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
