# 【OpenNext×Cloudflare Workers+D1】BetterAuth 認証付き URL 短縮サービス開発チュートリアル（027・刷新版）

## 導入（The "Why"）

このチュートリアルは、既に本リポジトリがセットアップ済みである前提で、OpenNext×Cloudflare Workers（`@opennextjs/cloudflare`）を用いて、BetterAuth 認証付きの URL 短縮サービスを構築・学習できるよう最新ベストプラクティスで再設計したものです。実運用を意識し、Cloudflare D1・Drizzle ORM・Edge ランタイムでの認証・デプロイまで、無駄のない流れで学べます。

## 技術スタック

- **フレームワーク**: Next.js 15（App Router）
- **実行環境**: Cloudflare Workers（OpenNext Cloudflare アダプタ）
- **認証**: BetterAuth（Edge 対応）
- **ORM**: Drizzle ORM（D1/SQLite）
- **データベース**: Cloudflare D1（単一 DB。ローカルは `--local` で実行）
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

# データベース作成（単一）
wrangler d1 create url-shortener-prod
```

### 1-2. `wrangler.jsonc` に D1 バインディングを追加（JSONC 例）

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "url-shortener-prod",
      "database_id": "<PROD_DB_ID>", // wrangler d1 info で確認
      "preview_database_id": "DB" // ローカル/プレビュー実行用
    }
  ]
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
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
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

### 2-3. 認証用スキーマ（`src/db/auth-schema.ts`）

Better Auth が利用する `user`/`session`/`account`/`verification` の最小スキーマを追加します（SQLite/D1）。

```typescript
// src/db/auth-schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .defaultNow()
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .defaultNow()
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .defaultNow()
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .defaultNow()
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
```

### 2-4. マイグレーション生成と適用

```bash
# 生成（./migrations に SQL が出力されます）
npx drizzle-kit generate

# ローカル適用（単一DBを --local で実行）
wrangler d1 migrations apply url-shortener-prod --local

# 本番適用（リモート）
wrangler d1 migrations apply url-shortener-prod --remote
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
# 本番用シークレット（単一サービスに設定）
wrangler secret put BETTERAUTH_SECRET --name 027-url-shortener
wrangler secret put GITHUB_CLIENT_ID --name 027-url-shortener
wrangler secret put GITHUB_CLIENT_SECRET --name 027-url-shortener
```

GitHub OAuth アプリのリダイレクト URL に「`https://<YOUR_DOMAIN>/api/auth/callback/github`」とローカル用「`http://localhost:3000/api/auth/callback/github`」を登録してください。

### 4-3. サーバー側の認証インスタンス（`src/lib/auth.ts`）

Better Auth を Drizzle（D1）に接続し、スキーマを渡します。`baseURL` は実行オリジンに合わせてください。

```ts
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as appSchema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";

let singleton: ReturnType<typeof betterAuth> | null = null;

export function auth() {
  if (singleton) return singleton;
  const { env } = getCloudflareContext<{ env: CloudflareEnv }>();
  const appUrl = env.APP_URL || "http://localhost:3000";

  const db = drizzle(env.DB, { schema: { ...authSchema, ...appSchema } });

  singleton = betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
    baseURL: appUrl,
    cookies: { secure: appUrl.startsWith("https://") },
    secret: env.BETTERAUTH_SECRET,
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID as string,
        clientSecret: env.GITHUB_CLIENT_SECRET as string,
      },
    },
  });
  return singleton;
}
```

### 4-4. 認証 API ルート（`app/api/auth/[...all]/route.ts`）

```ts
// app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const runtime = "edge";
export const { GET, POST } = toNextJsHandler(auth().handler);
```

### 4-4. 認証ボタン（Client 推奨）

```tsx
// components/auth-buttons.tsx
"use client";
import { createAuthClient } from "better-auth/react";
const authClient = createAuthClient();

export function AuthButtons() {
  return (
    <div className="flex gap-3">
      <button onClick={() => authClient.signIn.social({ provider: "github" })}>
        Sign in with GitHub
      </button>
      <button onClick={() => authClient.signOut()}>Sign Out</button>
    </div>
  );
}
```

---

## 5. アプリ機能の実装（URL 作成とリダイレクト）

### 5-1. 短縮 URL を作成する Server Action（`app/action.ts`）

```typescript
// app/action.ts
"use server";

import { headers } from "next/headers";
import { getDbFromEnv } from "@/db";
import { links } from "@/db/schema";
import { auth } from "@/lib/auth";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

export async function createShortLink(_prev: unknown, formData: FormData) {
  const session = await auth().api.getSession({ headers: await headers() });
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
  params: Promise<{ shortId: string }>;
}) {
  const db = getDbFromEnv();
  const { shortId } = await params;
  const result = await db
    .select()
    .from(links)
    .where(eq(links.shortId, shortId));
  const link = result[0];

  if (link) redirect(link.originalUrl);
  notFound();
}
```

### 5-3. メインページ（ベストプラクティス構成）

- ページ本体（`app/page.tsx`）は Server Component のまま維持し、Client が必要な箇所だけを別ファイルへ分離します。
- Client Component はファイル先頭に`"use client"`を配置し、`useFormState`/`useFormStatus`を安全に利用します。

#### 5-3-1. 送信ボタン（`app/components/SubmitButton.tsx`）

```tsx
// app/components/SubmitButton.tsx
"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
    >
      {pending ? "生成中..." : "短縮URLを作成"}
    </button>
  );
}
```

#### 5-3-2. フォーム（`app/components/ShortenForm.tsx`）

```tsx
// app/components/ShortenForm.tsx
"use client";
import { useFormState } from "react-dom";
import { createShortLink } from "@/app/action";
import { SubmitButton } from "./SubmitButton";

export function ShortenForm() {
  const [state, formAction] = useFormState(createShortLink, {
    message: "",
  } as any);
  const shortHref = state?.shortId ? `/${state.shortId}` : "";

  return (
    <form action={formAction} className="flex w-full max-w-xl flex-col gap-3">
      <input
        name="url"
        type="url"
        required
        placeholder="https://example.com/article"
        className="w-full rounded-md border px-3 py-2"
      />
      <SubmitButton />
      {state?.message && (
        <p className="text-sm text-gray-600">{state.message}</p>
      )}
      {state?.shortId && (
        <p className="text-sm">
          短縮URL:{" "}
          <a className="text-blue-600 underline" href={shortHref}>
            {shortHref}
          </a>
        </p>
      )}
    </form>
  );
}
```

#### 5-3-3. ページ本体（`app/page.tsx`）

```tsx
// app/page.tsx
import { AuthButtons } from "@/components/auth-buttons";
import { ShortenForm } from "./components/ShortenForm";

export default function Page() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center gap-8 p-6 sm:p-10">
      <h1 className="text-2xl font-semibold">URL 短縮サービス</h1>
      <AuthButtons />
      <ShortenForm />
    </div>
  );
}
```

- 注意: `page.tsx`では`useFormState`/`useFormStatus`などの Client Hooks を import しないでください（Server Component のままにするため）。

---

## 6. 開発・デプロイ

### 6-1. ローカル開発

```bash
npm run dev

# スキーマ更新時はローカルDBへ反映（単一DBを --local で）
wrangler d1 migrations apply url-shortener-prod --local
```

開発中に Cloudflare 環境値・D1 バインディングにアクセスする場合、`getCloudflareContext()` を利用します。

### 6-2. Secrets の登録（本番）

```bash
wrangler secret put BETTERAUTH_SECRET --name 027-url-shortener
wrangler secret put GITHUB_CLIENT_ID --name 027-url-shortener
wrangler secret put GITHUB_CLIENT_SECRET --name 027-url-shortener
```

### 6-3. デプロイ（OpenNext Cloudflare）

```bash
npm run preview  # 事前確認
npm run deploy   # 本番デプロイ
```

デプロイ後、D1 スキーマを本番へ適用：

```bash
wrangler d1 migrations apply url-shortener-prod --remote
```

---

## 7. ベストプラクティスと補足

- **Edge/Workers 対応**: `export const runtime = "edge"` を Route/ページに明示。Node API 依存は避け、`nodejs_compat` は必要最小限
- **環境変数/Secrets**: `process.env` ではなく Cloudflare の Bindings/Secrets を使用（`getCloudflareContext().env`）。ローカルは `.dev.vars`
- **OAuth 設定**: GitHub のコールバック URL を`/api/auth/callback/github`に設定（ローカル/本番）
- **Next.js 導入**: App Router では `toNextJsHandler(auth.handler)` のエクスポートが推奨
- **型安全**: `wrangler types` で生成された `CloudflareEnv` を使い、`getCloudflareContext<{ env: CloudflareEnv }>()` で活用
- **マイグレーション運用**: 単一 DB に対して、開発は `--local`、本番は `--remote` で適用
- **UI/UX**: Tailwind v4 をモバイルファーストで適用（シンプルでモダンな UI）

---

## 参考リンク（公式ドキュメント）

- **OpenNext Cloudflare**: `/opennextjs/opennextjs-cloudflare`
- **Cloudflare D1**: `/llmstxt/developers_cloudflare_com-d1-llms-full.txt`
- **Drizzle ORM**: `/drizzle-team/drizzle-orm-docs`
- **BetterAuth（Next.js App Router）**: `/better-auth/better-auth` の Next.js セクション
- **Next.js**: `/vercel/next.js`

---

## 結び

本チュートリアルは、OpenNext×Cloudflare Workers を前提に、D1・Drizzle・BetterAuth を最新の推奨構成で統合しました。単一 D1 に統一し、開発は `--local`、本番は `--remote` の運用で安全・シンプルに管理できます。ここから短縮 URL の分析やメタデータ拡張、レート制御、ダッシュボード UI などを拡張して、プロダクション品質に磨き込んでいきましょう。
