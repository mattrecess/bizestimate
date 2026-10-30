"use client";
import { useEffect, useState } from "react";
import { isSaved, toggleSaved } from "@/lib/saved";
import Icon from "./Icon";

// Puts a business on (or takes it off) the visitor's Radar. "compact" is the round icon on list cards,
// which sit inside a link, so a tap here mustn't also open the business.
export default function RadarButton({ id, name, city, compact = false }: { id: string; name: string; city: string; compact?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(isSaved(id));
    sync();
    window.addEventListener("saved-changed", sync);
    return () => window.removeEventListener("saved-changed", sync);
  }, [id]);
  const label = on ? "On your radar" : "Add to radar";
  const click = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); toggleSaved({ id, name, city }); };
  return compact ? (
    <button className={`radar-pin ${on ? "on" : ""}`} onClick={click} aria-pressed={on} aria-label={`${label}: ${name}`} title={label}>
      <Icon name="radar" size={16} />
    </button>
  ) : (
    <button className={`btn radar-btn ${on ? "on" : ""}`} onClick={click} aria-pressed={on}>
      <Icon name="radar" size={15} />{label}
    </button>
  );
}
