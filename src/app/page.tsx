import { AuthButtons } from "@/components/auth-buttons";
import { ShortenForm } from "./components/ShortenForm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

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
    </div>
  );
}
