import { redirect, notFound } from "next/navigation";
import { getDbFromEnv } from "@/db";
import { links } from "@/db/schema";
import { eq } from "drizzle-orm";

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
