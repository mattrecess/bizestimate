"use client";
import { useEffect, useState } from "react";
import type { Contact } from "@/lib/contact";
import type { OwnerContact } from "@/lib/pdl";
import { askSignIn } from "@/lib/saved";

// Published contact details, loaded on request so they aren't in the page crawlers read.
export default function ContactCard({ id, name, owner, embedded = false }: { id: string; name: string; owner: string | null; embedded?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [contact, setContact] = useState<(Contact & { allowance?: { used: number; limit: number; plan: string } | null }) | null>(null);
  const [error, setError] = useState("");
  const [ownerInfo, setOwnerInfo] = useState<(OwnerContact & { owner: string; phonesHidden?: number; phonesBlocked?: "pro" | "terms" | null }) | null>(null);
  const [agreed, setAgreed] = useState(false);

  async function acceptTerms() {
    await fetch("/api/contact/terms", { method: "POST" }).catch(() => {});
    lookupOwner();
  }
  const [ownerState, setOwnerState] = useState<"idle" | "loading">("idle");
  const [ownerError, setOwnerError] = useState("");
  useEffect(() => { setContact(null); setState("idle"); setOwnerInfo(null); setOwnerError(""); }, [id]);

  async function lookupOwner() {
    setOwnerState("loading");
    setOwnerError("");
    try {
      const res = await fetch(`/api/contact/${id}/owner`, { method: "POST" });
      const data = await res.json();
      if (res.status === 401) { setOwnerState("idle"); askSignIn({ contactFor: name }); return; }
      if (!res.ok) throw new Error(data.error || "Couldn't look up the owner.");
      setOwnerInfo(data);
      setOwnerState("idle");
    } catch (e) {
      setOwnerError(e instanceof Error ? e.message : "Couldn't look up the owner.");
      setOwnerState("idle");
    }
  }

  async function show() {
    setState("loading");
    try {
      const res = await fetch(`/api/contact/${id}`);
      const data = await res.json();
      // Signed-in users only, so many businesses a month on the free plan (lib/reveals.ts).
      if (res.status === 401) { setState("idle"); askSignIn({ contactFor: name }); return; }
      if (res.status === 402) {
        setState("idle");
        window.dispatchEvent(new CustomEvent("upgrade-needed", { detail: { used: data.used, limit: data.limit, price: data.price } }));
        return;
      }
      if (data.signIn) { setState("idle"); askSignIn({ contactFor: name }); return; }
      if (!res.ok) throw new Error(data.error || "Couldn't load contact details.");
      setContact(data);
      setState("idle");
      // The owner's direct contacts come with them, for signed-in visitors (others are asked to sign in).
      if (owner && !data.hidden) lookupOwner();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load contact details.");
      setState("error");
    }
  }

  const empty = contact && !contact.phones.length && !contact.emails.length;
  return (
    <div className={embedded ? "contact-card embedded" : "contact-card"}>
      <div className="contact-head">
        {!embedded && <b>Contact</b>}
        {!contact && (
          <button className="btn" onClick={show} disabled={state === "loading"}>
            {state === "loading" ? "Loading…" : "Show contact info"}
          </button>
        )}
      </div>
      {state === "error" && <p className="disclaimer">{error}</p>}
      {contact?.allowance && contact.allowance.plan !== "pro" && (
        <p className="disclaimer reveals-left">{Math.max(contact.allowance.limit - contact.allowance.used, 0)} of {contact.allowance.limit} free
          contact lookups left this month</p>
      )}
      {contact?.hidden && <p className="disclaimer">This business asked for its contact details not to be shown.</p>}
      {empty && !contact?.hidden && <p className="disclaimer">No published phone or email found yet.</p>}
      {contact && (
        <ul className="contact-list">
          {contact.phones.map((p) => (
            <li key={p.value}>
              <a href={`tel:${p.value.replace(/\D/g, "")}`}>{p.value}</a>
              <span className="src">{p.url ? <a href={p.url} target="_blank" rel="nofollow noopener noreferrer">{p.source}</a> : p.source}</span>
            </li>
          ))}
          {contact.emails.map((e) => (
            <li key={e.value}>
              <a href={`mailto:${e.value}`}>{e.value}</a>
              <span className="src">
                {e.owner && <span className="badge good">Likely {owner ? owner.split(/\s+/)[0] + "'s" : "the owner's"}</span>}{" "}
                {e.url ? <a href={e.url} target="_blank" rel="nofollow noopener noreferrer">{e.source}</a> : e.source}
              </span>
            </li>
          ))}
        </ul>
      )}
      {owner && contact && !contact.hidden && (
        <div className="owner-lookup">
          {ownerState === "loading" ? (
            <p className="disclaimer"><span className="spinner" aria-hidden /> Looking up {owner.split(/\s+/)[0]}&apos;s direct contact…</p>
          ) : !ownerInfo ? null : !ownerInfo.found ? (
            <p className="disclaimer">No direct email or phone found for {ownerInfo.owner}.</p>
          ) : (
            <>
              <div className="owner-lookup-head"><b>{ownerInfo.name ?? ownerInfo.owner}</b>{ownerInfo.title ? ` · ${ownerInfo.title}` : ""}</div>
              <ul className="contact-list">
                {ownerInfo.emails.map((e) => (
                  <li key={e.value}><a href={`mailto:${e.value}`}>{e.value}</a><span className="src">{e.kind === "work" ? "Work email" : "Email"}</span></li>
                ))}
                {ownerInfo.phones.map((p) => (
                  <li key={p.value}><a href={`tel:${p.value.replace(/[^\d+]/g, "")}`}>{p.value}</a><span className="src">{p.kind === "mobile" ? "Mobile" : "Phone"}</span></li>
                ))}
                {ownerInfo.linkedin && <li><a href={ownerInfo.linkedin} target="_blank" rel="nofollow noopener noreferrer">LinkedIn profile</a><span className="src">LinkedIn</span></li>}
              </ul>
              {ownerInfo.phonesBlocked === "pro" && !!ownerInfo.phonesHidden && (
                <p className="phone-gate">{ownerInfo.phonesHidden === 1 ? "A direct phone number is" : `${ownerInfo.phonesHidden} direct phone numbers are`} available
                  with SeeBITDA Pro.</p>
              )}
              {ownerInfo.phonesBlocked === "terms" && !!ownerInfo.phonesHidden && (
                <div className="phone-gate terms">
                  <b>Before we show phone numbers</b>
                  <p>These may be personal cell phones. By continuing you agree to use them only for one-to-one
                    business outreach, and:</p>
                  <ul>
                    <li>not to auto-dial, robocall or text them without the person&apos;s consent (TCPA);</li>
                    <li>to check the National Do Not Call Registry before any sales call;</li>
                    <li>to stop contacting anyone who asks you to;</li>
                    <li>not to resell, share or bulk-export them.</li>
                  </ul>
                  <label className="check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I agree to these terms
                    and SeeBITDA&apos;s <a href="/terms" target="_blank">Terms</a></label>
                  <button className="btn primary" disabled={!agreed} onClick={acceptTerms}>Show phone numbers</button>
                </div>
              )}
              <p className="disclaimer">From People Data Labs. For one-to-one outreach only: no auto-dialing or texting
                mobile numbers, and include an opt-out in any email.</p>
            </>
          )}
          {ownerError && <p className="disclaimer">{ownerError}</p>}
        </div>
      )}
    </div>
  );
}
