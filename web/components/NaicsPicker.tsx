"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { blurOnEnter, isTouch } from "@/lib/touch";

// Every 2022 NAICS code (sector to 6-digit industry) as an expandable, searchable checklist, with how
// many listed businesses fall under each. Titles: public/naics2022.json (Census 2022 NAICS, via the
// MIT-licensed naicsjs package). PPP borrowers used 2017 codes; the few that 2022 renumbered are added
// from our data, marked "2017 code".
type Row = { code: string; title: string; count: number; legacy?: boolean };

const MAX_SEARCH_ROWS = 400;

export default function NaicsPicker({ selected, onChange }: { selected: string[]; onChange: (codes: string[]) => void }) {
  const [titles, setTitles] = useState<Record<string, string> | null>(null);
  const [inUse, setInUse] = useState<{ code: string; label: string; count: number }[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/naics2022.json").then((r) => r.json()).then(setTitles).catch(() => setTitles({}));
    fetch("/api/naics").then((r) => r.json()).then(setInUse).catch(() => {});
  }, []);

  const { rows, byCode, kids } = useMemo(() => {
    const byCode = new Map<string, Row>();
    for (const [code, title] of Object.entries(titles ?? {})) byCode.set(code, { code, title, count: 0 });
    // Businesses under each code and all its parents.
    for (const u of inUse) {
      if (!byCode.has(u.code)) byCode.set(u.code, { code: u.code, title: `${u.label} (2017 code)`, count: 0, legacy: true });
      for (let n = 2; n <= u.code.length; n++) {
        const r = byCode.get(u.code.slice(0, n));
        if (r) r.count += u.count;
      }
    }
    const rows = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
    // Children: the next level down; a 5-digit group with a single, same-named 6-digit code is skipped.
    const kids = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.code.length === 2) continue;
      let parentLen = r.code.length - 1;
      while (parentLen >= 2 && !byCode.has(r.code.slice(0, parentLen))) parentLen--;
      const parent = r.code.slice(0, parentLen);
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent)!.push(r);
    }
    for (const [code, list] of kids) {
      if (code.length === 5 && list.length === 1 && list[0].title === byCode.get(code)?.title) {
        const parent = code.slice(0, 4);
        kids.set(parent, (kids.get(parent) ?? []).map((r) => (r.code === code ? list[0] : r)));
      }
    }
    return { rows, byCode, kids };
  }, [titles, inUse]);

  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  const expand = (code: string) => setOpen((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  const line = (r: Row, depth: number, hasKids: boolean) => (
    <div key={r.code} className={`naics-row ${r.count ? "" : "none"}`} style={{ paddingLeft: 4 + depth * 16 }}>
      {hasKids
        ? <button className="caret" aria-label={open.has(r.code) ? "Collapse" : "Expand"} aria-expanded={open.has(r.code)} onClick={() => expand(r.code)}>
            <Icon name="chevron" size={13} className={open.has(r.code) ? "" : "closed"} />
          </button>
        : <span className="caret" />}
      <label>
        <input type="checkbox" checked={selected.includes(r.code)} onChange={() => toggle(r.code)} />
        <span className="code">{r.code}</span><span className="label">{r.title}</span>
        <span className="count">{r.count.toLocaleString()}</span>
      </label>
    </div>
  );

  function tree(code: string, depth: number): React.ReactNode[] {
    const r = byCode.get(code)!;
    const children = kids.get(code) ?? [];
    const out: React.ReactNode[] = [line(r, depth, children.length > 0)];
    if (open.has(code)) for (const c of children) out.push(...tree(c.code, depth + 1));
    return out;
  }

  const q = query.trim().toLowerCase();
  const matches = q ? rows.filter((r) => r.code.startsWith(q) || r.title.toLowerCase().includes(q)).slice(0, MAX_SEARCH_ROWS) : [];
  return (
    <>
      <input className="filter-input" placeholder="Search all NAICS codes: 2382, janitorial…" value={query} autoFocus={!isTouch()} enterKeyHint="done" onKeyDown={blurOnEnter}
        onChange={(e) => setQuery(e.target.value)} />
      <div className="check-list naics-tree">
        {!titles && <div className="naics-row">Loading…</div>}
        {q
          ? (matches.length ? matches.map((r) => line(r, r.code.length - 2, false)) : <div className="naics-row none">No matching codes</div>)
          : rows.filter((r) => r.code.length === 2).flatMap((r) => tree(r.code, 0))}
      </div>
    </>
  );
}
