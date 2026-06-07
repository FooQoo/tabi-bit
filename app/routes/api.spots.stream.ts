import { google } from "@ai-sdk/google";
import { Output, streamText } from "ai";

import type { Route } from "./+types/api.spots.stream";
import {
  generateSpotsRequestSchema,
  MAX_SPOTS_PER_SESSION,
  SPOT_BATCH_SIZE,
  SPOT_GENERATION_MODEL,
  spotCategoryLabels,
  spotSchema,
} from "~/lib/spot-model";

type StreamEvent =
  | { type: "spot"; spot: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

const encoder = new TextEncoder();

function encodeEvent(event: StreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function buildPrompt({
  travelImage,
  prefecture,
  excludeNames,
  count,
}: {
  travelImage: string;
  prefecture: { label: string };
  excludeNames: string[];
  count: number;
}) {
  const categories = Object.entries(spotCategoryLabels)
    .map(([key, label]) => `${key}: ${label}`)
    .join("\n");
  const excluded = excludeNames.length > 0 ? excludeNames.join("、") : "なし";

  return `あなたは日本旅行に詳しい編集者です。ユーザーの旅のイメージに合う実在スポットを${count}件生成してください。
定番の観光地リストではなく、旅の途中で少し道をそれたくなる「寄り道」の発見感を重視してください。

旅のイメージ:
${travelImage}

対象エリア:
日本 / ${prefecture.label}

すでに表示済みのスポット名:
${excluded}

カテゴリ:
${categories}

厳守する条件:
- ${prefecture.label}内に実在する観光地、店舗、施設、自然スポットのみを返す。
- 架空の場所、実在風の名称、所在が曖昧な場所は絶対に返さない。
- スポット名は検索可能な正式名称、または一般的に使われる名称にする。
- excludeNamesと同じスポット、または明らかに同一のスポットは返さない。
- 有名スポットだけで埋めない。商店街の一角、小さな公園、展望デッキ、地元の店、水辺の歩道、駅から少し外れた場所など、寄り道として面白い実在スポットを必ず混ぜる。
- ${count}件のうち半数以上は、旅の主目的ではないが立ち寄ると気分が変わるスポットにする。
- detourLevel は 1=目的地向き、2=寄り道向き、3=かなり寄り道感が強い、で評価する。
- detourLevel が3のスポットを少なくとも2件含める。
- detourAppeal は「なぜ寄り道として面白いか」を60文字以内で具体的に書く。
- latitude / longitude はその実在スポットのおおよその座標にする。
- budgetYen は1人あたりの目安。無料の場合は min/max ともに0にする。
- description は80文字以内で、旅のイメージとの相性が分かる内容にする。
- highlights は2から4件にする。
- 日本語は自然で読みやすく、誤字・脱字・不自然な造語を含めない。
- country は必ず "Japan" にする。
- prefecture は必ず "${prefecture.label}" にする。
- id は英数字とハイフンだけの短い一意な文字列にする。`;
}

export async function action({ request }: Route.ActionArgs) {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
          controller.enqueue(
            encodeEvent({
              type: "error",
              message: "GOOGLE_GENERATIVE_AI_API_KEY が設定されていません。",
            }),
          );
          controller.enqueue(encodeEvent({ type: "done" }));
          controller.close();
          return;
        }

        const parsed = generateSpotsRequestSchema.safeParse(
          await request.json(),
        );

        if (!parsed.success) {
          controller.enqueue(
            encodeEvent({
              type: "error",
              message: "生成条件を確認してください。",
            }),
          );
          controller.enqueue(encodeEvent({ type: "done" }));
          controller.close();
          return;
        }

        const remaining =
          MAX_SPOTS_PER_SESSION - parsed.data.alreadyGeneratedCount;
        const count = Math.max(
          0,
          Math.min(parsed.data.count, SPOT_BATCH_SIZE, remaining),
        );

        if (count === 0) {
          controller.enqueue(encodeEvent({ type: "done" }));
          controller.close();
          return;
        }

        const { elementStream } = streamText({
          model: google(SPOT_GENERATION_MODEL),
          output: Output.array({ element: spotSchema }),
          prompt: buildPrompt({ ...parsed.data, count }),
          temperature: 0.9,
        });

        for await (const spot of elementStream) {
          controller.enqueue(
            encodeEvent({
              type: "spot",
              spot: { ...spot, id: crypto.randomUUID() },
            }),
          );
        }

        controller.enqueue(encodeEvent({ type: "done" }));
        controller.close();
      } catch (error) {
        console.error(error);
        controller.enqueue(
          encodeEvent({
            type: "error",
            message: "スポット生成に失敗しました。",
          }),
        );
        controller.enqueue(encodeEvent({ type: "done" }));
        controller.close();
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
