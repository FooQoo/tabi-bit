import {
  getPlacesApiKey,
  resolvePlaceIdsByNames,
} from "~/server/repositories/google-places";
import { logger } from "~/server/observability/logger";

type ResolveRequest = {
  spots?: Array<{ id: string; name: string; area: string }>;
};

type ResolveResult = {
  results: Array<{ id: string; placeId: string | null }>;
};

function jsonResponse(payload: ResolveResult) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function emptyResults(
  spots: NonNullable<ResolveRequest["spots"]>,
): ResolveResult {
  return { results: spots.map((s) => ({ id: s.id, placeId: null })) };
}

export async function action({ request }: { request: Request }) {
  let spots: NonNullable<ResolveRequest["spots"]> = [];

  try {
    const body = (await request
      .json()
      .catch(() => null)) as ResolveRequest | null;
    spots = body?.spots ?? [];

    const apiKey = getPlacesApiKey();
    if (!apiKey || spots.length === 0) {
      return jsonResponse(emptyResults(spots));
    }

    const texts = spots.map((s) => `${s.name} ${s.area}`.trim());
    const placeIds = await resolvePlaceIdsByNames(texts, apiKey);

    return jsonResponse({
      results: spots.map((s, i) => ({
        id: s.id,
        placeId: placeIds[i] ?? null,
      })),
    });
  } catch (error) {
    if (request.signal.aborted) {
      return jsonResponse(emptyResults(spots));
    }
    logger.error("spots.resolve", "resolve failed", error);
    return jsonResponse(emptyResults(spots));
  }
}
