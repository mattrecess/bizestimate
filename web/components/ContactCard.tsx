"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/contact";
import Icon from "./Icon";

// RocketReach profiles for the owner (or the company), for visitors with their own account.
function rocketReachSearch(name: string, owner: string | null) {
  const company = name.replace(/,?\s+(LLC|L\.L\.C\.|INC\.?|CORP\.?|CO\.?|PLLC|LTD\.?)$/i, "");
  const q = `site:rocketreach.co ${owner ? `"${owner}" ` : ""}"${company}"`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Published contact details, loaded on request so they aren't in the page crawlers read.
export default function ContactCard({ id, name, owner }: { id: string; name: string; owner: string | null }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setContact(null); setState("idle"); }, [id]);

  async function show() {
    setState("loading");
    try {
      const res = await fetch(`/api/contact/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load contact details.");
      setContact(data);
      setState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load contact details.");
      setState("error");
    }
  }

  const empty = contact && !contact.phones.length && !contact.emails.length;
  return (
    <div className="contact-card">
      <div className="contact-head">
        <b>Contact</b>
        {!contact && (
          <button className="btn" onClick={show} disabled={state === "loading"}>
            {state === "loading" ? "Loading…" : "Show contact"}
          </button>
        )}
      </div>
      {state === "error" && <p className="disclaimer">{error}</p>}
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
      <div className="contact-foot">
        <a href={rocketReachSearch(name, owner)} target="_blank" rel="nofollow noopener noreferrer">
          Find {owner ?? "the owner"} on RocketReach <Icon name="external" size={12} />
        </a>
        <Link href={`/contact-request?business=${id}`}>Request removal or correction</Link>
      </div>
    </div>
  );
}
