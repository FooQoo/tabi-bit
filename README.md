# tabi-bit

旅のイメージを言葉で入力すると、AI がその雰囲気に合う実在スポットを提案し、
「寄り道」を楽しめる最適な巡回プランを自動で組み立てる旅行プランナーです。

定番の観光地を並べるだけでなく、商店街の一角・小さな展望デッキ・地元の店・水辺の歩道など、
旅の途中で少し道をそれたくなる発見を重視しています。

## 主な機能

- **AI スポット提案（ストリーミング）** — 旅のイメージと都道府県から、Google Gemini が実在スポットを逐次生成。NDJSON ストリームで届いた順に表示します。
- **寄り道度（detourLevel）** — 各スポットを「目的地向き 〜 かなり寄り道感が強い」の 3 段階で評価し、寄り道スポットを必ず混ぜます。
- **巡回プラン最適化** — 選んだスポットから、移動効率・寄り道度・カテゴリの多様性・予算・所要時間を考慮してプランを構築します。
  - 経路順の最適化（最近傍法ベースの並び替え）
  - 移動手段の推定（徒歩 / 電車 / 車）と移動時間の見積もり
  - 営業時間を踏まえたスケジューリング（開店待ち・営業時間外の検出）
  - 時間帯フィット（朝・昼・午後・夕方）の考慮
  - **海越えペナルティ** — 直線経路が海上を通るレグを日本の陸地マスクで判定し、到達困難な並びを回避
  - 所要時間・予算の上限制約
- **地図表示** — Leaflet（OpenStreetMap）でプランの経路順を可視化。
- **スポット写真** — Google Places API (New) から実在スポットの写真を取得して表示。

## 技術スタック

- [React Router v7](https://reactrouter.com/)（Framework mode / SSR）
- React 19 + TypeScript
- [Vercel AI SDK](https://sdk.vercel.ai/) + `@ai-sdk/google`（Gemini）
- Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com/)（Radix UI / lucide-react）
- [Leaflet](https://leafletjs.com/)
- [Zod](https://zod.dev/)（スキーマ / バリデーション）
- Vite 8 / Vitest 4
- パッケージマネージャ: **pnpm**

## ディレクトリ構成

```
app/
├── domain/              # ドメインロジック（フレームワーク非依存・テスト対象）
│   ├── spot/            # スポットのモデル・スキーマ・定数
│   ├── plan/            # プラン最適化（経路順・スケジュール・移動・travel）
│   ├── geo/             # 日本の陸地マスク（海越え判定）
│   └── prefecture/      # 都道府県マスタ
├── server/              # サーバー専用層
│   ├── repositories/    # 外部 API クライアント（AI / Google Places）
│   └── services/        # ユースケース（スポット生成 / 写真解決）
├── routes/              # React Router のルート
│   ├── home.tsx             # メイン画面
│   ├── api.spots.stream.ts  # AI スポット生成（NDJSON ストリーミング）
│   └── api.spots.photo.ts   # スポット写真取得
├── components/          # UI コンポーネント（plan-map, ui/*）
└── root.tsx
scripts/
└── build-japan-land-mask.mjs   # 海越え判定用の陸地マスク生成
```

## セットアップ

### 必要なもの

- Node.js 20 以上
- pnpm
- API キー
  - **Google Gemini API キー**（`GOOGLE_GENERATIVE_AI_API_KEY`）
  - **Google Maps Platform キー**（`GOOGLE_PLACES_API_KEY`、Places API (New) を有効化）

### インストール

```bash
pnpm install
```

### 環境変数

`.env.example` をコピーして `.env` を作成し、キーを設定します。

```bash
cp .env.example .env
```

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=
GOOGLE_PLACES_API_KEY=
```

> `GOOGLE_PLACES_API_KEY` が未設定でもアプリは動作します（スポット写真が表示されないだけ）。

### 開発サーバー

```bash
pnpm dev
```

http://localhost:5173 で起動します。

## スクリプト

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー（HMR 付き） |
| `pnpm build` | 本番ビルド |
| `pnpm start` | ビルド成果物を本番起動 |
| `pnpm typecheck` | 型生成 + 型チェック |
| `pnpm test` | テスト実行（Vitest） |
| `pnpm test:watch` | テストのウォッチ実行 |

## 陸地マスクの再生成

プラン最適化は「海を挟んで直線だけ近いスポット」を避けるため、日本周辺の陸/海ビットマスク
（`app/domain/geo/japan-land-mask.ts`）を同梱している。これは生成物で、ランタイムは完全オフライン。
解像度・範囲を変えたいときだけ、ネットワーク接続のうえ再生成する（生成物はコミットする）:

```bash
node scripts/build-japan-land-mask.mjs
```

ペナルティの強さは `app/domain/plan/travel.ts` の `WATER_PENALTY_MIN_PER_KM` で調整できる。

## デプロイ

### Vercel（推奨）

React Router v7 を公式サポートしており、`react-router.config.ts` に `@vercel/react-router` の
`vercelPreset()` を設定済みです。

1. [Vercel](https://vercel.com) でこのリポジトリを Import
2. 環境変数 `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_PLACES_API_KEY` を登録（Production / Preview）
3. Deploy

以降は push で自動デプロイ、PR ごとにプレビュー URL が発行されます。

### Docker

`Dockerfile` も同梱しています（AWS ECS / Google Cloud Run / Fly.io / Railway などに展開可能）。

```bash
docker build -t tabi-bit .
docker run -p 3000:3000 \
  -e GOOGLE_GENERATIVE_AI_API_KEY=... \
  -e GOOGLE_PLACES_API_KEY=... \
  tabi-bit
```

> 注意: 同梱の `Dockerfile` は `npm` 前提です。pnpm に合わせる場合は調整してください。

## ライセンス

Private project.
</content>
