import {
  MAX_SPOTS_PER_SESSION,
  SPOT_BATCH_SIZE,
  spotCategoryLabels,
  type GeneratedSpot,
  type GenerateSpotsRequest,
} from "~/domain/spot/spot";
import { streamSpotElements } from "~/server/infrastructure/ai";

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
- latitude / longitude はその実在スポットのおおよその座標にする。
- budgetYen は1人あたりの目安。無料の場合は min/max ともに0にする。
- description は50文字以内で、旅のイメージとの相性が分かる内容にする。
- highlights は2件にする。
- 日本語は自然で読みやすく、誤字・脱字・不自然な造語を含めない。
- country は必ず "Japan" にする。
- prefecture は必ず "${prefecture.label}" にする。
- id は英数字とハイフンだけの短い一意な文字列にする。`;
}

/**
 * リクエストに応じた件数を算出する。
 * セッション上限・バッチ上限・残数のいずれも超えないようにクランプする。
 */
export function resolveSpotCount(request: GenerateSpotsRequest): number {
  const remaining = MAX_SPOTS_PER_SESSION - request.alreadyGeneratedCount;
  return Math.max(0, Math.min(request.count, SPOT_BATCH_SIZE, remaining));
}

/**
 * スポット生成のオーケストレーション。
 * プロンプトを組み立て、生成された各スポットに一意な id を付与して返す。
 */
export async function* generateSpots(
  request: GenerateSpotsRequest,
): AsyncGenerator<GeneratedSpot> {
  const count = resolveSpotCount(request);
  if (count === 0) {
    return;
  }

  const prompt = buildPrompt({
    travelImage: request.travelImage,
    prefecture: request.prefecture,
    excludeNames: request.excludeNames,
    count,
  });

  for await (const spot of streamSpotElements(prompt)) {
    yield { ...spot, id: crypto.randomUUID() };
  }
}
