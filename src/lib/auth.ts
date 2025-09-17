import { betterAuth } from "better-auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as appSchema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";

let singleton: ReturnType<typeof betterAuth> | null = null;

export async function auth() {
  if (singleton) return singleton;
  const { env } = await getCloudflareContext<{ env: CloudflareEnv }>({
    async: true,
  });
  const appUrl = env.APP_URL || "http://localhost:3000";

  // Drizzle にはアプリ用 + 認証用スキーマをまとめて渡す
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
