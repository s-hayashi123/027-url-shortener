import { AuthButtons } from "@/components/auth-buttons";
import { ShortenForm } from "./components/ShortenForm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getDbFromEnv } from "@/db";
import { links } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export default async function Page() {
  const session = await (
    await auth()
  ).api.getSession({ headers: await headers() });
  const isSignedIn = Boolean(session); // sessionの有無で判定
  const who =
    session?.user?.email ??
    session?.user?.name ??
    (session?.user?.id as string | undefined) ??
    "";
  const label = isSignedIn ? `サインイン中: ${who}` : "未サインイン";

  // 直近作成した短縮リンク一覧（サインイン時のみ）
  let myLinks:
    | {
        id: number;
        shortId: string;
        originalUrl: string | null;
        userId: string | null;
      }[]
    | [] = [];
  if (isSignedIn) {
    const db = getDbFromEnv();
    const userId =
      (session!.user.id as string | undefined) ||
      (session!.user.email as string | undefined) ||
      "";
    if (userId) {
      myLinks = await db
        .select()
        .from(links)
        .where(eq(links.userId, userId))
        .orderBy(desc(links.id))
        .limit(10);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center gap-8 p-6 sm:p-10">
      <h1 className="text-2xl font-semibold">URL 短縮サービス</h1>

      <div className="flex w-full max-w-xl items-center justify-between gap-4">
        <span
          className={`rounded-full px-3 py-1 text-sm ${
            isSignedIn
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {label}
        </span>
        <AuthButtons />
      </div>

      {!isSignedIn && (
        <p className="w-full max-w-xl text-sm text-gray-600">
          サインインすると短縮URLを作成できます。
        </p>
      )}

      <ShortenForm disabled={!isSignedIn} />

      {isSignedIn && myLinks.length > 0 && (
        <div className="w-full max-w-xl">
          <h2 className="mb-2 text-sm font-medium text-gray-700">
            最近作成したリンク
          </h2>
          <ul className="flex flex-col gap-1">
            {myLinks.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 truncate"
              >
                <a
                  className="text-blue-600 underline"
                  href={`/${l.shortId}`}
                >{`/${l.shortId}`}</a>
                <span className="truncate text-sm text-gray-600">
                  {l.originalUrl}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
