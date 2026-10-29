import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Vercel's daily cron (vercel.json) starts the GitHub data jobs, because GitHub's own scheduler often
// skips or delays them. Needs GITHUB_DISPATCH_TOKEN (a fine-grained token for this repository with
// Actions: read and write) and CRON_SECRET, which Vercel sends as a bearer token on cron calls.
const REPO = process.env.GITHUB_REPO || "mattrecess/bizestimate";
const WORKFLOWS = ["etl.yml", "enrich.yml", "site-check.yml"];

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_DISPATCH_TOKEN isn't set" }, { status: 503 });
  const results: Record<string, number> = {};
  for (const wf of WORKFLOWS) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      body: JSON.stringify({ ref: "main" }),
    });
    results[wf] = r.status;   // 204 = started
  }
  const ok = Object.values(results).every((s) => s === 204);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 });
}
