"use client";
import { useEffect, useState } from "react";
import { signInAvailable, type Pending } from "@/lib/saved";
import { GoogleG } from "./AccountMenu";
import Icon from "./Icon";

// The "sign in first" dialog, opened by askSignIn (lib/saved.ts) when a signed-out visitor adds a
// company to My Radar or saves a search. Once they're back from Google, the company is added for them.
export default function SignInPrompt() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    const show = (e: Event) => setPending((e as CustomEvent<Pending>).detail ?? {});
    window.addEventListener("signin-needed", show);
    return () => window.removeEventListener("signin-needed", show);
  }, []);
  useEffect(() => {
    if (!pending) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPending(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [pending]);
  if (!pending) return null;

  // Back to the table after signing in, when that's what they asked for.
  const next = (() => {
    const u = new URL(window.location.href);
    if (pending.table) u.searchParams.set("layout", "table");
    return u.pathname + u.search;
  })();
  const what = pending.biz ? <>Sign in to add <b>{pending.biz.name}</b> to your radar.</>
    : pending.search ? <>Sign in to save this search.</>
    : pending.exporting ? <>Sign in to export this list to Excel.</>
    : pending.table ? <>Sign in to see every business as a sortable table, with ownership and banks.</>
    : pending.ownerFor ? <>Sign in to search the web for the owner of <b>{pending.ownerFor}</b>. Free accounts get 5 searches a month.</>
    : pending.contactFor ? <>Sign in to see contact info for <b>{pending.contactFor}</b>. Free accounts get 5 businesses a month.</> : <>Sign in to start your radar.</>;
  return (
    <div className="signin-backdrop" onClick={() => setPending(null)}>
      <div className="signin-dialog" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="signin-close" aria-label="Close" onClick={() => setPending(null)}><Icon name="x" size={18} /></button>
        <div className="signin-icon"><Icon name="radar" size={26} /></div>
        <h2 id="signin-title">{pending.exporting ? "Export to Excel" : pending.table ? "Table view" : pending.ownerFor ? "Find the owner"
          : pending.contactFor ? "See contact info" : "Keep companies on your radar"}</h2>
        <p>{what} Your radar and saved searches follow you to every device. It&apos;s free.</p>
        {signInAvailable() ? (
          <a className="btn signin-google" href={`/api/auth/google?next=${encodeURIComponent(next)}`}><GoogleG /> Continue with Google</a>
        ) : (
          <p className="signin-soon">Sign-in is coming soon. Check back shortly.</p>
        )}
      </div>
    </div>
  );
}
