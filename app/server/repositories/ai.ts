import * as Sentry from "@sentry/react-router";
import { google } from "@ai-sdk/google";
import { Output, streamText } from "ai";

import {
  SPOT_GENERATION_MODEL,
  spotSchema,
  type GeneratedSpot,
} from "~/domain/spot/spot";
import { logger } from "~/server/observability/logger";

/**
 * Gemini を用いてスポットを生成し、要素ストリームを返す。
 * AI プロバイダへの依存をこの層に閉じ込める。
 */
export function streamSpotElements(prompt: string): AsyncIterable<GeneratedSpot> {
  const span = Sentry.startInactiveSpan({
    name: "ai.streamSpotElements",
    op: "ai.run",
    attributes: {
      "ai.model": SPOT_GENERATION_MODEL,
      "ai.prompt.length": prompt.length,
    },
  });

  const { elementStream } = streamText({
    model: google(SPOT_GENERATION_MODEL),
    output: Output.array({ element: spotSchema }),
    prompt,
    temperature: 0.9,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel: "minimal",
        },
      },
    },
    onFinish: ({ totalUsage, finishReason }) => {
      span.setAttributes({
        "ai.tokens.input": totalUsage.inputTokens,
        "ai.tokens.output": totalUsage.outputTokens,
        "ai.tokens.total": totalUsage.totalTokens,
        "ai.finishReason": finishReason,
      });
      span.setStatus({ code: finishReason === "error" ? 2 : 1 });
      span.end();
    },
    onError: ({ error }) => {
      span.setStatus({ code: 2 });
      span.end();
      logger.error("ai.stream", "streamSpotElements failed", error);
    },
  });

  return elementStream;
}
