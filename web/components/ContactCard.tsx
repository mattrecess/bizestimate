"use client";
import { useEffect, useState } from "react";
import type { Contact } from "@/lib/contact";
import type { OwnerContact } from "@/lib/pdl";
import { askSignIn } from "@/lib/saved";
import Icon from "./Icon";

// One line of contact info: icon, the phone or email (link), and where it came from, kept on one line.
function Row({ kind, value, href, note, noteUrl }: { kind: "phone" | "mail"; value: string; href: string; note: string; noteUrl?: string }) {
  return (
    <li className="c-row">
      <Icon name={kind} size={14} />
      <a className="c-val" href={href} title={value}>{value}</a>
      <span className="c-src">{noteUrl ? <a href={noteUrl} target="_blank" rel="nofollow noopener noreferrer">{note}</a> : note}</span>
    </li>
  );
}

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
      {contact?.hidden && <p className="disclaimer">This business asked for its contact details not to be shown.</p>}
      {empty && !contact?.hidden && !ownerInfo?.found && <p className="disclaimer">No published phone or email found yet.</p>}
      {contact && !contact.hidden && (() => {
        // The owner's own contacts first (People Data Labs, and any published email that looks like theirs),
        // then the company's.
        const direct = ownerInfo?.found ? ownerInfo : null;
        const ownerEmails = [...(direct?.emails ?? []).map((e) => ({ value: e.value, note: e.kind === "work" ? "Work email" : "Email" })),
          ...contact.emails.filter((e) => e.owner).map((e) => ({ value: e.value, note: e.source, url: e.url }))]
          .filter((e, i, all) => all.findIndex((x) => x.value.toLowerCase() === e.value.toLowerCase()) === i);
        const ownerPhones = (direct?.phones ?? []).map((p) => ({ value: p.value, note: p.kind === "mobile" ? "Mobile" : "Direct" }));
        const companyEmails = contact.emails.filter((e) => !e.owner && !ownerEmails.some((o) => o.value.toLowerCase() === e.value.toLowerCase()));
        const first = owner ? owner.split(/\s+/)[0] : "Owner";
        return (<>
          {(ownerEmails.length > 0 || ownerPhones.length > 0) && (
            <div className="c-group">
              <div className="c-label">{first}&apos;s direct</div>
              <ul className="contact-list">
                {ownerPhones.map((p) => <Row key={p.value} kind="phone" value={p.value} href={`tel:${p.value.replace(/[^\d+]/g, "")}`} note={p.note} />)}
                {ownerEmails.map((e) => <Row key={e.value} kind="mail" value={e.value} href={`mailto:${e.value}`} note={e.note} noteUrl={"url" in e ? (e.url as string | undefined) ?? undefined : undefined} />)}
              </ul>
            </div>
          )}
          {(contact.phones.length > 0 || companyEmails.length > 0) && (
            <div className="c-group">
              <div className="c-label">Company</div>
              <ul className="contact-list">
                {contact.phones.map((p) => <Row key={p.value} kind="phone" value={p.value} href={`tel:${p.value.replace(/\D/g, "")}`} note={p.source} noteUrl={p.url ?? undefined} />)}
                {companyEmails.map((e) => <Row key={e.value} kind="mail" value={e.value} href={`mailto:${e.value}`} note={e.source} noteUrl={e.url ?? undefined} />)}
              </ul>
            </div>
          )}
        </>);
      })()}
      {owner && contact && !contact.hidden && (
        <div className="owner-lookup">
          {ownerState === "loading" && <p className="disclaimer"><span className="spinner" aria-hidden /> Looking up {owner.split(/\s+/)[0]}&apos;s direct contact…</p>}
          {ownerInfo && !ownerInfo.found && <p className="disclaimer">No direct email or phone found for {ownerInfo.owner}.</p>}
          {ownerInfo?.found && ownerInfo.phonesBlocked === "pro" && !!ownerInfo.phonesHidden && (
            <p className="phone-gate">{ownerInfo.phonesHidden === 1 ? "A direct phone number is" : `${ownerInfo.phonesHidden} direct phone numbers are`} available
              with SeeBITDA Pro.</p>
          )}
          {ownerInfo?.found && ownerInfo.phonesBlocked === "terms" && !!ownerInfo.phonesHidden && (
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
          {ownerError && <p className="disclaimer">{ownerError}</p>}
        </div>
      )}
      {contact && !contact.hidden && (
        <p className="c-foot">
          {ownerInfo?.found && <>Direct contacts from People Data Labs, for one-to-one outreach only. </>}
          {contact.allowance && contact.allowance.plan !== "pro" && <>{Math.max(contact.allowance.limit - contact.allowance.used, 0)} of {contact.allowance.limit} free lookups left this month.</>}
        </p>
      )}
    </div>
  );
}
