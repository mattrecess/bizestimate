"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";

export type UpgradeNeeded = { used: number; limit: number; price: string; kind?: "contact" | "owner-search" | "table" | "table-rows" | "export" };

// "You've used this month's free contact lookups / owner searches": opened by the contact card (a 402 from
// /api/contact) or the owner search button (a 402 from /api/owner-search).
// Until billing is built, Pro can't be bought here yet; "Notify me" records the interest.
export default function UpgradePrompt() {
  const [info, setInfo] = useState<UpgradeNeeded | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const show = (e: Event) => { setSent(false); setInfo((e as CustomEvent<UpgradeNeeded>).detail); };
    window.addEventListener("upgrade-needed", show);
    return () => window.removeEventListener("upgrade-needed", show);
  }, []);
  useEffect(() => {
    if (!info) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setInfo(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [info]);
  if (!info) return null;

  async function notify() {
    await fetch("/api/pro-interest", { method: "POST" }).catch(() => {});
    setSent(true);
  }

  return (
    <div className="signin-backdrop" onClick={() => setInfo(null)}>
      <div className="signin-dialog upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="signin-close" aria-label="Close" onClick={() => setInfo(null)}><Icon name="x" size={18} /></button>
        <div className="signin-icon"><Icon name="user" size={24} /></div>
        <h2 id="upgrade-title">Upgrade to SeeBITDA Pro</h2>
        <p>{info.kind === "table-rows" ? <>Free accounts see the first 3 rows of the table. Pro shows every business.</>
          : info.kind === "table" ? <>Email and phone numbers in the table are part of Pro.</>
          : info.kind === "export" ? <>Exporting to Excel is part of Pro.</>
          : info.kind === "owner-search"
          ? <>You&apos;ve used all {info.limit} of this month&apos;s free owner searches.</>
          : <>You&apos;ve seen contact info for {info.used} of {info.limit} businesses this month on the free plan.</>}</p>
        <ul className="upgrade-list">
          <li>The full table: every business, sortable</li>
          <li>Owner and business email and phone in the table</li>
          <li>Export any list to Excel</li>
          <li>Unlimited owner searches</li>
          <li>Contact info for up to 300 businesses a month</li>
          <li>Owners&apos; direct email, phone and mobile</li>
        </ul>
        <div className="upgrade-price"><b>{info.price}</b>/month</div>
        {sent ? <p className="signin-soon">Thanks. We&apos;ll email you as soon as Pro opens.</p>
          : <button type="button" className="btn primary signin-google" onClick={notify}>Notify me when Pro opens</button>}
        {(info.kind === "owner-search" || !info.kind || info.kind === "contact") &&
          <p className="upgrade-reset">Free {info.kind === "owner-search" ? "searches" : "lookups"} reset on the 1st of each month.</p>}
      </div>
    </div>
  );
}
