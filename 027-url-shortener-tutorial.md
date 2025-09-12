# 【OpenNext×Cloudflare Workers+D1】BetterAuth 認証付き URL 短縮サービス開発チュートリアル（027・刷新版）

## 導入（The "Why"）

このチュートリアルは、既に本リポジトリがセットアップ済みである前提で、OpenNext×Cloudflare Workers（`@opennextjs/cloudflare`）を用いて、BetterAuth 認証付きの URL 短縮サービスを構築・学習できるよう最新ベストプラクティスで再設計したものです。実運用を意識し、Cloudflare D1・Drizzle ORM・Edge ランタイムでの認証・デプロイまで、無駄のない流れで学べます。

## 技術スタック

- **フレームワーク**: Next.js 15（App Router）
- **実行環境**: Cloudflare Workers（OpenNext Cloudflare アダプタ）
- **認証**: BetterAuth（Edge 対応）
- **ORM**: Drizzle ORM（D1/SQLite）
- **データベース**: Cloudflare D1
- **UI**: Tailwind CSS v4（モバイルファースト）
- **CLI**: Wrangler v4
- **ビルド/デプロイ**: `@opennextjs/cloudflare`（`opennextjs-cloudflare build/deploy/preview`）

---

## 0. 前提と全体像（セットアップ済みプロジェクトの確認）

本プロジェクトはすでに作成済みです。以下のポイントだけ確認してください。

- **スクリプト（`package.json`）**
  - `dev`: `next dev`
  - `deploy`: `opennextjs-cloudflare build && opennextjs-cloudflare deploy`
  - `preview`: `opennextjs-cloudflare build && opennextjs-cloudflare preview`
  - `cf-typegen`: `wrangler types --env-interface CloudflareEnv ./cloudflare-env.d.ts`
- **OpenNext 設定（`open-next.config.ts`）**: 必要に応じて R2 などのオプションを設定
- **Wrangler 設定（`wrangler.jsonc`）**: Cloudflare Workers 向け。`compatibility_date`、`nodejs_compat` などが有効
- **Next.js 開発（`next.config.ts`）**: 末尾で `initOpenNextCloudflareForDev()` を呼び出し、開発中も `getCloudflareContext()` が使えます

以降は、この構成を前提に「D1×Drizzle×BetterAuth」を段階的に組み込みます。

---

## 1. D1（Cloudflare Database）の準備

### 1-1. Wrangler ログインと DB 作成

```bash
npm i -g wrangler
wrangler login

# データベース作成
wrangler d1 create url-shortener-dev
wrangler d1 create url-shortener-prod
```

### 1-2. `wrangler.jsonc` に D1 バインディングを追加（JSONC 例）

```jsonc
{
  // 既存設定のまま、追記します
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "url-shortener-dev",
      "database_id": "<DEV_DB_ID>", // wrangler d1 info で確認
      "preview_database_id": "DB" // Pages/preview互換のための指定（Workers開発にも有用）
    }
  ],
  "env": {
    "production": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "url-shortener-prod",
          "database_id": "<PROD_DB_ID>"
        }
      ]
    }
  }
}
```

更新後、型定義を生成してエディタ補完を効かせます。

```bash
npm run cf-typegen
```

---

## 2. Drizzle ORM とスキーマ定義

### 2-1. ライブラリのインストール

```bash
npm i drizzle-orm nanoid
npm i -D drizzle-kit
```

### 2-2. Drizzle 設定（`drizzle.config.ts`）

Cloudflare D1 は SQLite 互換です。`drizzle-kit` で SQL を生成し、Wrangler の `d1 migrations apply` で適用します。

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations", // D1のマイグレーション適用先
  dialect: "sqlite",
});
```

### 2-3. スキーマ定義（`src/db/schema.ts`）

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
});

export const links = sqliteTable("links", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  shortId: text("short_id").notNull().unique(),
  originalUrl: text("original_url").notNull(),
  userId: text("user_id").references(() => users.id),
});
```

### 2-4. マイグレーション生成と適用

```bash
# 生成（./migrations に SQL が出力されます）
npx drizzle-kit generate

# ローカルDBへ適用（フォルダ単位で適用）
wrangler d1 migrations apply url-shortener-dev --local

# 本番DBへ適用（--env production を付与）
wrangler d1 migrations apply url-shortener-prod --remote --env production
```

---

## 3. Cloudflare 環境での Drizzle クライアント

Cloudflare Workers では `process.env` は使わず、OpenNext の `getCloudflareContext()` から `env` を取得します。D1 は `env.DB` 経由で参照します。

```typescript
// src/db/index.ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
```

サーバーコンテキストからの参照例：

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db";

export function getDbFromEnv() {
  const { env } = getCloudflareContext<{ env: CloudflareEnv }>();
  return getDb(env.DB);
}
```

---

## 4. BetterAuth の統合（Edge 対応）

### 4-1. インストール

```bash
npm install better-auth
```

### 4-2. Secrets/Bindings の設定（Cloudflare）

GitHub OAuth などのクレデンシャルと `BETTERAUTH_SECRET` を Secrets に登録します。ローカル開発では `.dev.vars`（このリポジトリに同梱）に同名キーを記述して使います。

```bash
# 本番用
wrangler secret put BETTERAUTH_SECRET --env production
wrangler secret put GITHUB_CLIENT_ID --env production
wrangler secret put GITHUB_CLIENT_SECRET --env production
```

### 4-3. 認証 API ルート（`app/api/auth/[...betterauth]/route.ts`）

```typescript
// app/api/auth/[...betterauth]/route.ts
import { BetterAuth } from "better-auth";
import GitHub from "better-auth/providers/github";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "edge"; // Workers 実行を明示

const { env } = getCloudflareContext<{ env: CloudflareEnv }>();

export const { handlers, auth, signIn, signOut } = BetterAuth({
  secret: env.BETTERAUTH_SECRET,
  providers: [
    GitHub({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
  ],
});

// Route Handler としてエクスポート
export const { GET, POST } = handlers;
```

### 4-4. 認証ボタン（Server Action）

```tsx
// components/auth-buttons.tsx
import { auth, signIn, signOut } from "@/app/api/auth/[...betterauth]/route";

export async function AuthButtons() {
  const session = await auth();

  if (!session?.user) {
    return (
      <form
        action={async () => {
          "use server";
          await signIn("github");
        }}
      >
        <button type="submit">Sign in with GitHub</button>
      </form>
    );
  }

  return (
    <div>
      <p>{session.user.email}</p>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button type="submit">Sign Out</button>
      </form>
    </div>
  );
}
```

---

## 5. アプリ機能の実装（URL 作成とリダイレクト）

### 5-1. 短縮 URL を作成する Server Action（`app/actions.ts`）

```typescript
// app/actions.ts
"use server";

import { getDbFromEnv } from "@/db";
import { links } from "@/db/schema";
import { auth } from "@/app/api/auth/[...betterauth]/route";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

export async function createShortLink(_prev: unknown, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { message: "認証が必要です。" };

  const url = String(formData.get("url") || "").trim();
  try {
    new URL(url);
  } catch {
    return { message: "URLが不正です。" };
  }

  const db = getDbFromEnv();
  const shortId = nanoid(7);

  const exists = await db
    .select()
    .from(links)
    .where(eq(links.shortId, shortId));
  if (exists.length) return { message: "再試行してください。", retry: true };

  await db
    .insert(links)
    .values({ originalUrl: url, shortId, userId: session.user.id });
  return { message: "成功！", shortId };
}
```

### 5-2. リダイレクトページ（`app/[shortId]/page.tsx`）

```tsx
// app/[shortId]/page.tsx
import { redirect, notFound } from "next/navigation";
import { getDbFromEnv } from "@/db";
import { links } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "edge"; // リダイレクトもWorkersで

export default async function ShortIdPage({
  params,
}: {
  params: { shortId: string };
}) {
  const db = getDbFromEnv();
  const result = await db
    .select()
    .from(links)
    .where(eq(links.shortId, params.shortId));
  const link = result[0];

  if (link) redirect(link.originalUrl);
  notFound();
}
```

---

## 6. 開発・デプロイ

### 6-1. ローカル開発

```bash
npm run dev

# スキーマ更新時はローカルDBへ反映
wrangler d1 migrations apply url-shortener-dev --local
```

開発中に Cloudflare 環境値・D1 バインディングにアクセスする場合、`getCloudflareContext()` を利用します。

### 6-2. Secrets の登録（本番）

```bash
wrangler secret put BETTERAUTH_SECRET --env production
wrangler secret put GITHUB_CLIENT_ID --env production
wrangler secret put GITHUB_CLIENT_SECRET --env production
```

### 6-3. デプロイ（OpenNext Cloudflare）

```bash
npm run preview  # 事前確認
npm run deploy   # 本番デプロイ
```

デプロイ後、D1 スキーマを本番へ適用：

```bash
wrangler d1 migrations apply url-shortener-prod --remote --env production
```

---

## 7. ベストプラクティスと補足

- **Edge/Workers 対応**: `export const runtime = "edge"` を Route/ページに明示。Node API 依存は避け、`nodejs_compat` は必要最小限
- **環境変数/Secrets**: `process.env` ではなく Cloudflare の Bindings/Secrets を使用（`getCloudflareContext().env`）。ローカルは `.dev.vars`
- **型安全**: `wrangler types` で生成された `CloudflareEnv` を使い、`getCloudflareContext<{ env: CloudflareEnv }>()` で活用
- **マイグレーション運用**: 開発は `--local`、本番は `--remote`＋`--env production` で適用
- **UI/UX**: Tailwind v4 をモバイルファーストで適用（シンプルでモダンな UI）

---

## 参考リンク（公式ドキュメント）

- **OpenNext Cloudflare**: `/opennextjs/opennextjs-cloudflare`
- **Cloudflare D1**: `/llmstxt/developers_cloudflare_com-d1-llms-full.txt`
- **Drizzle ORM**: `/drizzle-team/drizzle-orm-docs`
- **BetterAuth**: `/websites/www_better-auth_com-docs-introduction`
- **Next.js**: `/vercel/next.js`

---

## 結び

本チュートリアルは、OpenNext×Cloudflare Workers を前提に、D1・Drizzle・BetterAuth を最新の推奨構成で統合しました。開発（`next dev`）から本番デプロイ（`npm run deploy`）までのパスと、D1 マイグレーションの運用、Edge ランタイムでの Secrets 参照方法を一通り学べます。ここから短縮 URL の分析やメタデータ拡張、レート制御、ダッシュボード UI などを拡張して、プロダクション品質に磨き込んでいきましょう。
