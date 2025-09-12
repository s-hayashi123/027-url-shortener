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
