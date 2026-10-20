import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);

// One pool per server instance; `prepare: false` keeps Supabase's transaction pooler happy.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
export const sql =
  globalForDb.sql ??
  postgres(url, { ssl: isLocal ? false : "require", prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
