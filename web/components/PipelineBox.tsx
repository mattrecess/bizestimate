"use client";
import { useEffect, useState } from "react";

type Note = { id: string; body: string; created_at: string };
type State = { entry: { status: string; follow_up: string | null } | null; notes: Note[] };
const STATUSES: [string, string][] = [["watching", "Watching"], ["contacted", "Contacted"], ["talking", "Talking"], ["passed", "Passed"]];

// Your pipeline tools on a business: shown only when you're signed in to /admin (the server says so).
export default function PipelineBox({ id }: { id: string }) {
  const [state, setState] = useState<State | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setState(null);
    fetch(`/api/admin/pipeline/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setState).catch(() => {});
  }, [id]);
  if (!state) return null;

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch(`/api/admin/pipeline/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) setState(await r.json());
    setBusy(false);
  }
  const status = state.entry?.status ?? "";
  const follow = state.entry?.follow_up ?? "";
  return (
    <div className="pipeline-box">
      <div className="pipeline-head">
        <b>My pipeline</b>
        <a href="/admin/pipeline">All →</a>
      </div>
      <div className="chips">
        {STATUSES.map(([k, label]) => (
          <button key={k} disabled={busy} className={`chip ${status === k ? "selected" : ""}`}
            onClick={() => send({ status: k, follow_up: follow })}>{label}</button>
        ))}
        {state.entry && <button className="link-btn" disabled={busy} onClick={() => send({ remove: true })}>Remove</button>}
      </div>
      <label className="follow">Follow up
        <input type="date" value={follow} onChange={(e) => send({ status: status || "watching", follow_up: e.target.value })} />
      </label>
      <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) { send({ note }); setNote(""); } }}>
        <textarea rows={2} placeholder="Add a private note (calls, who you spoke to, asking price…)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" disabled={busy || !note.trim()}>Add note</button>
      </form>
      {state.notes.length > 0 && (
        <ul className="notes">
          {state.notes.map((n) => (
            <li key={n.id}>
              <span className="when">{new Date(n.created_at).toLocaleDateString()}</span> {n.body}
              <button className="link-btn" onClick={() => send({ delete_note: n.id })} aria-label="Delete note">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
