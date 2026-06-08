import type { Route } from "./+types/api.spots.stream";
import { generateSpotsRequestSchema } from "~/domain/spot/spot";
import { generateSpots } from "~/server/services/spot-generation";
import { logger } from "~/server/observability/logger";

type StreamEvent =
  | { type: "spot"; spot: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

const encoder = new TextEncoder();

function encodeEvent(event: StreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function action({ request }: Route.ActionArgs) {
  const abortSignal = request.signal;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: StreamEvent) => {
        if (closed || abortSignal.aborted) return;
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const fail = (message: string) => {
        send({ type: "error", message });
        send({ type: "done" });
        close();
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
          if (closed || abortSignal.aborted) return;
          send({ type: "spot", spot });
        }

        send({ type: "done" });
      } catch (error) {
        if (!abortSignal.aborted) {
          logger.error("spots.stream", "spot generation failed", error);
          fail("スポット生成に失敗しました。");
        }
      } finally {
        close();
      }
    },
    cancel() {
      // Client disconnected; nothing to clean up because the start()
      // closure observes abortSignal/closed and exits the loop.
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
