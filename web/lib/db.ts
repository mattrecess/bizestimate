import postgres from "postgres";

// Trim stray quotes/whitespace and the [ ] Supabase shows around the password placeholder.
const url = (process.env.DATABASE_URL ?? "")
  .trim()
  .replace(/^["']|["']$/g, "")
  .replace(/^(\w+:\/\/[^:/@]+:)\[(.*)\](@.*)$/, "$1$2$3");
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);

// The site goes through Supabase's transaction pooler (port 6543), where a connection holds a database
// slot only while a query runs. On the session pooler (5432, what the data jobs use) every open
// connection holds a slot for its whole life, so when crawlers made Vercel start many copies of the
// site at once, the slots ran out and nothing could connect: the outages of Oct 30-31.
const siteUrl = url.replace(/(@[^/]*pooler\.supabase\.com):5432\//, "$1:6543/");

// One pool per server instance; `prepare: false` keeps the transaction pooler happy. Idle connections
// are closed after 20s rather than kept by every warm instance.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
export const sql =
  globalForDb.sql ??
  postgres(siteUrl, { ssl: isLocal ? false : "require", prepare: false, max: 5, idle_timeout: 20, connect_timeout: 15 });
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

type Sql = typeof sql;
/** Runs a query with a time limit (in its own transaction, so it works through the transaction pooler);
 *  past the limit, or on any error, returns `fallback`. For the extras on a page (comparables, banks,
 *  locations) that shouldn't hold the database when it's busy: the page shows without them instead. */
export async function capped<T>(ms: number, run: (q: Sql) => PromiseLike<Iterable<T>>, fallback: T[]): Promise<T[]> {
  try {
    return await sql.begin(async (tx) => {
      await tx`set local statement_timeout = ${sql.unsafe(String(Math.round(ms)))}`;
      return [...await run(tx as unknown as Sql)];
    }) as T[];
  } catch {
    return fallback;
  }
}
