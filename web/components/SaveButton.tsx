"use client";
import { useEffect, useState } from "react";
import { isSaved, toggleSaved } from "@/lib/saved";
import Icon from "./Icon";

export default function SaveButton({ id, name, city }: { id: string; name: string; city: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const sync = () => setSaved(isSaved(id));
    sync();
    window.addEventListener("saved-changed", sync);
    return () => window.removeEventListener("saved-changed", sync);
  }, [id]);
  return (
    <button className={`btn ${saved ? "saved" : ""}`} onClick={() => toggleSaved({ id, name, city })} aria-pressed={saved}>
      <Icon name="star" size={15} />{saved ? "Saved" : "Save"}
    </button>
  );
}
