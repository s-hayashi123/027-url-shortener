"use server";

import { getDbFromEnv } from "@/db";
import { links, users } from "@/db/schema";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function createShortLink(_prev: unknown, formData: FormData) {
  const session = await (
    await auth()
  ).api.getSession({ headers: await headers() });
  if (!session) return { message: "認証が必要です。" }; // ← 厳しすぎるキー依存をやめる

  const url = String(formData.get("url") || "").trim();
  try {
    new URL(url);
  } catch {
    return { message: "URLが不正です。" };
  }

  const db = getDbFromEnv();
  const shortId = nanoid(7);

  // ユーザーのミラー保存（idが無ければemailをid代わりに利用）
  const userId =
    (session.user.id as string | undefined) ?? (session.user.email as string);
  const userEmail = (session.user.email as string | undefined) ?? "";
  if (!userId) return { message: "認証が必要です。" };

  // upsert: 既存ならemailを更新、無ければinsert
  await db
    .insert(users)
    .values({ id: userId, email: userEmail })
    .onConflictDoUpdate({ target: users.id, set: { email: userEmail } });

  const exists = await db
    .select()
    .from(links)
    .where(eq(links.shortId, shortId));
  if (exists.length) return { message: "再試行してください。", retry: true };

  await db.insert(links).values({
    originalUrl: url,
    shortId,
    userId,
  });
  return { message: "成功！", shortId };
}
