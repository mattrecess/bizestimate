"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import Icon from "./Icon";

type Suggestion = { id: number; name: string; city: string; est_revenue_mid: string };

// Search input with live business suggestions; Enter searches, picking a suggestion opens it.
export default function SearchBox({ value, onChange, onPick }: {
  value: string;
  onChange: (q: string) => void;
  onPick: (id: number) => void;
}) {
  const [text, setText] = useState(value);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (text.trim().length < 2) { setItems([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/businesses?q=${encodeURIComponent(text)}&limit=6`, { signal: ctrl.signal })
        .then((r) => r.json()).then((d) => { setItems(d.results ?? []); setActive(-1); }).catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [text]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(s: Suggestion) {
    setOpen(false);
    onPick(Number(s.id));
  }

  return (
    <div className="searchbox" ref={box}>
      <Icon name="search" className="icon-search" />
      <input
        type="search" placeholder="Search a business, city or industry" value={text} aria-label="Search businesses"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
          else if (e.key === "Enter") { if (active >= 0 && items[active]) pick(items[active]); else setOpen(false); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {text && (
        <button className="clear" aria-label="Clear search" onClick={() => { setText(""); onChange(""); setItems([]); }}>
          <Icon name="x" size={16} />
        </button>
      )}
      {open && items.length > 0 && (
        <ul className="suggestions" role="listbox">
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
