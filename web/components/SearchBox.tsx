"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import Icon from "./Icon";

type Suggestion = { id: number; name: string; city: string; est_revenue_mid: string };

// Search input with live business suggestions; Enter searches, picking a suggestion opens it.
// The suggestions come from the page's own search results, so typing sends a single request.
export default function SearchBox({ value, onChange, onPick, suggestions, busy = false }: {
  value: string;
  busy?: boolean;   // a search is on its way: the magnifier becomes a spinner
  onChange: (q: string) => void;
  onPick: (id: number) => void;
  suggestions: { q: string; items: Suggestion[]; industry?: string | null; total?: number } | null;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setText(value), [value]);

  // Only results for what's in the box (not a previous query) are offered.
  const current = text.trim().length >= 2 && suggestions && suggestions.q === text ? suggestions : null;
  const items = current?.items ?? [];
  const industry = current?.industry;
  useEffect(() => setActive(-1), [suggestions]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Blurring puts a phone's keyboard away once a search is done.
  function done() {
    setOpen(false);
    input.current?.blur();
  }

  function pick(s: Suggestion) {
    done();
    onPick(Number(s.id));
  }

  return (
    <div className="searchbox" ref={box}>
      {busy ? <span className="spinner icon-search" aria-label="Searching" /> : <Icon name="search" className="icon-search" />}
      <input
        ref={input} type="search" enterKeyHint="search" placeholder="Search a business, city, industry or NAICS code" value={text} aria-label="Search businesses"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
          else if (e.key === "Enter") { if (active >= 0 && items[active]) pick(items[active]); else done(); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {text && (
        <button className="clear" aria-label="Clear search" onClick={() => { setText(""); onChange(""); }}>
          <Icon name="x" size={16} />
        </button>
      )}
      {open && (items.length > 0 || industry) && (
        <ul className="suggestions" role="listbox">
          {/* Read as an industry: the list already shows them all, so this just closes the menu. */}
          {industry && (
            <li>
              <button className="s-industry" onMouseDown={(e) => e.preventDefault()} onClick={done}>
                <span className="s-name"><Icon name="search" size={14} />{industry.startsWith("NAICS") ? `All businesses in ${industry}` : `All ${industry.toLowerCase()} businesses`}</span>
                {current?.total != null && <span className="s-meta">{current.total.toLocaleString()} found</span>}
              </button>
            </li>
          )}
          {items.map((s, i) => (
            <li key={s.id}>
              <button role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                <span className="s-name">{s.name}</span>
                <span className="s-meta">{s.city} · {money(s.est_revenue_mid)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
