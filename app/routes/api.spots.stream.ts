import type { Route } from "./+types/api.spots.stream";
import { generateSpotsRequestSchema } from "~/domain/spot/spot";
import { generateSpots } from "~/server/services/spot-generation";

type StreamEvent =
  | { type: "spot"; spot: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

const encoder = new TextEncoder();

function encodeEvent(event: StreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function action({ request }: Route.ActionArgs) {
  const stream = new ReadableStream({
    async start(controller) {
      const fail = (message: string) => {
        controller.enqueue(encodeEvent({ type: "error", message }));
        controller.enqueue(encodeEvent({ type: "done" }));
        controller.close();
      };

      try {
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
          fail("GOOGLE_GENERATIVE_AI_API_KEY が設定されていません。");
          return;
        }

        const parsed = generateSpotsRequestSchema.safeParse(
          await request.json(),
        );

        if (!parsed.success) {
          fail("生成条件を確認してください。");
          return;
        }

        for await (const spot of generateSpots(parsed.data)) {
          controller.enqueue(encodeEvent({ type: "spot", spot }));
        }

        controller.enqueue(encodeEvent({ type: "done" }));
        controller.close();
      } catch (error) {
        console.error(error);
        fail("スポット生成に失敗しました。");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
