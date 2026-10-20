"use client";
import { useState } from "react";

export default function ClaimForm({ businessId }: { businessId: number }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch("/api/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, business_id: businessId, request_removal: form.request_removal === "on" }),
    });
    if (res.ok) setStatus("sent");
    else { setStatus("error"); setError((await res.json()).error ?? "Something went wrong"); }
  }

  if (status === "sent") return <p>Thanks — we&apos;ll verify ownership and follow up by email.</p>;
  return (
    <form className="form" onSubmit={submit}>
      <input name="contact_name" placeholder="Your name" required />
      <input name="contact_email" type="email" placeholder="Work email" required />
      <input name="reported_revenue" type="number" min="0" placeholder="Actual annual revenue (optional)" />
      <input name="reported_ebitda" type="number" placeholder="Actual EBITDA (optional)" />
      <textarea name="message" rows={3} placeholder="Anything else?" />
      <label><input type="checkbox" name="request_removal" /> Remove this listing</label>
      <button className="primary" disabled={status === "sending"}>Submit claim</button>
      {status === "error" && <p style={{ color: "var(--warn)" }}>{error}</p>}
    </form>
  );
}
