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

  const next = window.location.pathname + window.location.search;
  const what = pending.biz ? <>Sign in to add <b>{pending.biz.name}</b> to your radar.</>
    : pending.search ? <>Sign in to save this search.</>
    : pending.exporting ? <>Sign in to export this list to Excel.</> : <>Sign in to start your radar.</>;
  return (
    <div className="signin-backdrop" onClick={() => setPending(null)}>
      <div className="signin-dialog" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="signin-close" aria-label="Close" onClick={() => setPending(null)}><Icon name="x" size={18} /></button>
        <div className="signin-icon"><Icon name="radar" size={26} /></div>
        <h2 id="signin-title">{pending.exporting ? "Export to Excel" : "Keep companies on your radar"}</h2>
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
