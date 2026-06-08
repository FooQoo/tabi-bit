<p align="center">
  <img src="./public/logo-title.png" alt="tabi-bit" width="420" />
</p>

<p align="center">
  <strong>AI が組み立てる、ちょっと寄り道したくなる旅プランナー</strong>
</p>

<p align="center">
  旅のイメージを言葉で入力すると、AI が雰囲気に合う実在スポットを提案し、<br/>
  移動効率・寄り道度・営業時間まで踏まえた最適な巡回プランを自動で組み立てます。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/React_Router-7-CA4245?logo=reactrouter&logoColor=white" alt="React Router 7" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite 8" />
  <img src="https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white" alt="Vitest 4" />
  <img src="https://img.shields.io/badge/Gemini-AI-4285F4?logo=googlegemini&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/Sentry-Observability-362D59?logo=sentry&logoColor=white" alt="Sentry" />
  <img src="https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel&logoColor=white" alt="Vercel" />
</p>

---

定番の観光地を並べるだけでなく、商店街の一角・小さな展望デッキ・地元の店・水辺の歩道など、
旅の途中で少し道をそれたくなる発見を重視しています。

## 主な機能

- **言葉でイメージを伝えるだけ** — 「夕方の海辺をのんびり」みたいなふんわりした言葉から、AI が実在のスポットを次々に提案します。
- **寄り道込みのおでかけプランを自動で** — 選んだスポットを、移動の効率・営業時間・寄り道感のバランスを見ながら、ちょうどいい順番でつないでくれます。
- **URL ひとつで共有・再開** — プランは URL に紐づいているので、家族や友達に送ったり、あとからもう一度開いて続きを楽しめます。

## 技術スタック

| レイヤ | 採用技術 |
|---|---|
| Web フレームワーク | [React Router v7](https://reactrouter.com/)（Framework mode / SSR / ファイルベースルーティング） |
| UI | React 19 + TypeScript / Tailwind CSS v4 / [shadcn/ui](https://ui.shadcn.com/) / Radix UI / lucide-react |
| AI | [Vercel AI SDK](https://sdk.vercel.ai/) + `@ai-sdk/google`（Gemini） |
| マップ / ジオ | [Leaflet](https://leafletjs.com/) + OpenStreetMap、自前の日本陸地マスク |
| バリデーション | [Zod](https://zod.dev/) |
| 観測性 | [Sentry](https://sentry.io/)（React Router 統合 + プロファイリング） / [Pino](https://getpino.io/) |
| ビルド / テスト | Vite 8 / Vitest 4 |
| パッケージマネージャ | **pnpm** |
| デプロイ | Vercel（公式 React Router プリセット）／ Docker |

## ディレクトリ構成

```
app/
├── domain/                  # ドメインロジック（フレームワーク非依存・テスト対象）
│   ├── spot/                # スポットのモデル・スキーマ・定数
│   ├── plan/                # プラン最適化（経路順・スケジュール・移動）
│   ├── geo/                 # 日本の陸地マスク（海越え判定）
│   └── prefecture/          # 都道府県マスタ
├── server/                  # サーバー専用層
│   ├── repositories/        # 外部 API クライアント（AI / Google Places）
│   ├── services/            # ユースケース（スポット生成 / 写真解決）
│   └── observability/       # Pino ロガー
├── routes/                  # React Router のファイルベースルート
│   ├── _index.tsx               # メイン画面
│   ├── sessions.$sessionId.tsx  # セッションパーマリンク（_index を再エクスポート）
│   ├── api.spots.stream.ts      # AI スポット生成（NDJSON ストリーミング）
│   ├── api.spots.resolve.ts     # スポット名 → placeId 解決
│   ├── api.spots.photo.ts       # スポット写真取得
│   └── [.]well-known.$.ts       # /.well-known/* の 404 サイレント化
├── components/              # UI コンポーネント（plan-map, ui/*）
├── lib/                     # 共通ユーティリティ
└── root.tsx                 # ルートレイアウト・リクエストロギング
public/
├── logo.png / logo-only.png / logo-title.png
└── favicon.ico
scripts/
└── build-japan-land-mask.mjs   # 海越え判定用の陸地マスク生成
```

## セットアップ

### 必要なもの

- Node.js 20 以上
- pnpm
- API キー
  - **Google Gemini API キー**（`GOOGLE_GENERATIVE_AI_API_KEY`）
  - **Google Maps Platform キー**（`GOOGLE_PLACES_API_KEY`、Places API (New) + Maps Tools (Grounding Lite) を有効化）

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
# 必須
GOOGLE_GENERATIVE_AI_API_KEY=
GOOGLE_PLACES_API_KEY=

# 任意（観測性）
SENTRY_DSN=                # サーバー側
VITE_SENTRY_DSN=           # クライアント側（ブラウザに露出するため VITE_ 接頭辞が必須）
# SENTRY_AUTH_TOKEN=       # ビルド時のソースマップアップロード用
```

> `GOOGLE_PLACES_API_KEY` が未設定でもアプリは動作します（スポット写真と Grounding Lite による解決が無効化されるだけ）。
> Sentry 関連は未設定なら初期化をスキップします。

### 開発サーバー

```bash
pnpm dev
```

http://localhost:5173 で起動します。

## スクリプト

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー（HMR 付き、Sentry インストルメント有効） |
| `pnpm build` | 本番ビルド |
| `pnpm start` | ビルド成果物を本番起動 |
| `pnpm typecheck` | 型生成 + 型チェック |
| `pnpm test` | テスト実行（Vitest） |
| `pnpm test:watch` | テストのウォッチ実行 |

## 陸地マスクの再生成

プラン最適化は「海を挟んで直線だけ近いスポット」を避けるため、日本周辺の陸/海ビットマスク
（`app/domain/geo/japan-land-mask.ts`）を同梱しています。これは生成物で、ランタイムは完全オフライン。
解像度・範囲を変えたいときだけ、ネットワーク接続のうえ再生成します（生成物はコミットする）:

```bash
node scripts/build-japan-land-mask.mjs
```

ペナルティの強さは `app/domain/plan/travel.ts` の `WATER_PENALTY_MIN_PER_KM` で調整できます。

## デプロイ

React Router v7 を公式サポートしている **Vercel** にデプロイしています。
`react-router.config.ts` に `@vercel/react-router` の `vercelPreset()` を設定済みで、
ビルド終了時に `sentryOnBuildEnd` でソースマップ連携も行います。

1. [Vercel](https://vercel.com) でこのリポジトリを Import
2. 環境変数 `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_PLACES_API_KEY`（必要なら Sentry 系も）を登録（Production / Preview）
3. Deploy

以降は push で自動デプロイ、PR ごとにプレビュー URL が発行されます。
