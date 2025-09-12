import { drizzle } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export function getDbFromEnv() {
  const { env } = getCloudflareContext<{ env: CloudflareEnv }>();
  return getDb(env.DB);
}
