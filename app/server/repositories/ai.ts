import { google } from "@ai-sdk/google";
import { Output, streamText } from "ai";

import {
  SPOT_GENERATION_MODEL,
  spotSchema,
  type GeneratedSpot,
} from "~/domain/spot/spot";

/**
 * Gemini を用いてスポットを生成し、要素ストリームを返す。
 * AI プロバイダへの依存をこの層に閉じ込める。
 */
export function streamSpotElements(prompt: string): AsyncIterable<GeneratedSpot> {
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
  });

  return elementStream;
}
