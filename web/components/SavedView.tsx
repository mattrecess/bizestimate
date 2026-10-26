"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { CompareRow } from "@/lib/compare";
import { money } from "@/lib/format";
import { removeSearch, savedBusinesses, savedSearches, toggleSaved, type SavedBiz, type SavedSearch } from "@/lib/saved";

const MAX_COMPARE = 5;

// Saved businesses (with their current estimates) and saved searches, from this browser's storage.
export default function SavedView() {
  const [list, setList] = useState<SavedBiz[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [rows, setRows] = useState<Record<string, CompareRow>>({});
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => { setList(savedBusinesses()); setSearches(savedSearches()); };
    sync();
    window.addEventListener("saved-changed", sync);
    return () => window.removeEventListener("saved-changed", sync);
  }, []);
  useEffect(() => {
    if (!list.length) return;
    fetch(`/api/compare?ids=${list.map((b) => b.id).join(",")}`).then((r) => r.json())
      .then((data: CompareRow[]) => setRows(Object.fromEntries(data.map((r) => [String(r.id), r])))).catch(() => {});
  }, [list]);

  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_COMPARE ? [...p, id] : p));
  return (
    <>
      <h1>Saved</h1>
      <p className="disclaimer">Kept in this browser only. Tick up to {MAX_COMPARE} businesses to compare them side by side.</p>
      <div className="section">
        <div className="saved-head">
          <h2>Businesses</h2>
          {picked.length >= 2 && <Link className="btn primary" href={`/compare?ids=${picked.join(",")}`}>Compare {picked.length}</Link>}
        </div>
        {!list.length ? <p className="disclaimer">Nothing saved yet. Use the Save button on a business.</p> : (
          <table>
            <thead><tr><th /><th>Business</th><th className="num">Est. revenue</th><th className="num hide-sm">Est. EBITDA</th><th /></tr></thead>
            <tbody>
              {list.map((b) => {
                const r = rows[b.id];
                return (
                  <tr key={b.id}>
                    <td><input type="checkbox" checked={picked.includes(b.id)} onChange={() => pick(b.id)} aria-label={`Compare ${b.name}`} /></td>
                    <td><Link href={`/business/${b.id}`}>{b.name}</Link><div className="disclaimer" style={{ margin: 0 }}>{b.city}</div></td>
                    <td className="num">{r ? money(r.est_revenue_mid) : "…"}</td>
                    <td className="num hide-sm">{r ? money(r.est_ebitda_mid) : "…"}</td>
                    <td><button className="link-btn" onClick={() => toggleSaved(b)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="section">
        <h2>Searches</h2>
        {!searches.length ? <p className="disclaimer">No saved searches. Use “Save search” above the business list.</p> : (
          <ul className="saved-searches">
            {searches.map((s) => (
              <li key={s.query}><Link href={`/?${s.query}`}>{s.label}</Link>
                <button className="link-btn" onClick={() => removeSearch(s.query)}>Remove</button></li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
