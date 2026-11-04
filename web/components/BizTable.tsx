"use client";
import { useEffect, useState } from "react";
import type { Extras } from "@/lib/extras";
import { money } from "@/lib/format";
import { industryLabel } from "@/lib/industries";
import { displayName } from "@/lib/seo";
import { estimateValue } from "@/lib/valuation";
import type { Biz } from "./BizCard";
import Icon from "./Icon";
import RadarButton from "./RadarButton";

// Column -> the sort it applies (click again to flip revenue); columns without one don't sort.
const COLS: { label: string; sort?: string; flip?: string; num?: boolean; cls?: string }[] = [
  { label: "Business", sort: "name" },
  { label: "Industry", cls: "hide-md" },
  { label: "City" },
  { label: "Est. value", sort: "value_desc", num: true },
  { label: "Revenue", sort: "revenue_desc", flip: "revenue_asc", num: true },
  { label: "EBITDA", sort: "ebitda_desc", num: true },
  { label: "Employees", sort: "jobs_desc", num: true },
  { label: "Ownership" },
  { label: "Owner" },
  { label: "Bank", cls: "hide-md" },
  { label: "Email" },
  { label: "Phone" },
  { label: "Sale signs", sort: "sell_desc", num: true },
];

// Extras are fetched for every loaded row (Pro) or just the visible ones (free).
const pro_limit = (n: number) => Math.min(n, 200);

// Columns that aren't in the list results (ownership, current owner, bank, Pro contacts), for the rows shown.
function useExtras(ids: string[]) {
  // pro: null until the first answer (rows stay limited until then).
  const [state, setState] = useState<{ pro: boolean | null; extras: Record<number, Extras> }>({ pro: null, extras: {} });
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`/api/businesses/extras?ids=${key}`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setState((s) => ({ pro: d.pro, extras: { ...s.extras, ...d.extras } })); }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return state;
}

const upgrade = (kind: "table" | "table-rows" = "table") =>
  window.dispatchEvent(new CustomEvent("upgrade-needed", { detail: { used: 0, limit: 0, price: "$99", kind } }));
// Free accounts see this many rows; the rest are part of Pro.
export const FREE_ROWS = 3;

// The search as a spreadsheet-style table: every column at a glance, sortable from the headers.
export default function BizTable({ rows, sort, onSort, onOpen, selectedId, total, onPro }: {
  rows: Biz[]; sort: string; onSort: (sort: string) => void; onOpen: (id: number) => void; selectedId: number | null;
  total?: number | null; onPro?: (pro: boolean) => void;
}) {
  const { pro, extras } = useExtras(rows.map((b) => String(b.id)).slice(0, pro_limit(rows.length)));
  useEffect(() => { if (pro !== null) onPro?.(pro); }, [pro, onPro]);
  const shown = pro ? rows : rows.slice(0, FREE_ROWS);
  const hidden = Math.max((total ?? rows.length) - shown.length, 0);
  const locked = <button type="button" className="t-pro" onClick={(e) => { e.stopPropagation(); upgrade(); }}>Pro</button>;
  return (
    <table className="biz-table">
      <thead>
        <tr>
          {COLS.map((c) => {
            const active = c.sort === sort || c.flip === sort;
            const next = c.flip && sort === c.sort ? c.flip : c.sort;
            return (
              <th key={c.label} className={[c.num ? "num" : "", c.cls ?? ""].join(" ")} aria-sort={active ? (sort.endsWith("_asc") || sort === "name" ? "ascending" : "descending") : undefined}>
                {c.sort ? (
                  <button type="button" className={`th-sort ${active ? "on" : ""}`} onClick={() => onSort(next!)}>
                    {c.label}{active && <Icon name="chevron" size={12} className={sort.endsWith("_asc") || sort === "name" ? "up" : ""} />}
                  </button>
                ) : c.label}
              </th>
            );
          })}
          <th aria-label="My Radar" />
        </tr>
      </thead>
      <tbody>
        {shown.map((b) => {
          const value = estimateValue(b);
          const sell = Number(b.sell_score) || 0;
          return (
            <tr key={b.id} className={selectedId === Number(b.id) ? "on" : ""} onClick={() => onOpen(Number(b.id))}>
              <td className="t-name">
                <a href={`/business/${b.id}`} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) e.preventDefault(); }}>{displayName(b.name)}</a>
                {b.locations ? <span className="t-sub">{b.locations + 1} locations</span> : null}
              </td>
              <td className="hide-md t-muted">{industryLabel(b.naics) ?? b.industry}</td>
              <td className="t-muted">{b.city}</td>
              <td className="num t-strong">{value ? money(value.mid) : "—"}</td>
              <td className="num">{money(b.est_revenue_mid)}</td>
              <td className="num">{money(b.est_ebitda_mid)}</td>
              <td className="num">{b.jobs_reported ?? "—"}</td>
              {(() => {
                const x = extras[Number(b.id)];
                const dash = <span className="t-muted">—</span>;
                return (<>
                  <td>{x ? <span className={`bp-own sm ${x.ownership.kind}`}>{x.ownership.label}</span> : dash}</td>
                  <td>{x?.current_owner ?? b.owner_name ?? dash}</td>
                  <td className="hide-md t-muted">{x?.bank ?? "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>{!pro ? locked : x?.email
                    ? <a href={`mailto:${x.email}`} title={x.email_owner ? "Owner's email" : "Business email"}>{x.email}</a> : dash}</td>
                  <td onClick={(e) => e.stopPropagation()} className="t-nowrap">{!pro ? locked : x?.phone
                    ? <a href={`tel:${x.phone}`} title={x.phone_owner ? "Owner's phone" : "Business phone"}>{x.phone}</a> : dash}</td>
                </>);
              })()}
              <td className="num">{sell >= 20 ? <span className={`badge ${sell >= 40 ? "warn" : ""}`}>{sell}</span> : <span className="t-muted">—</span>}</td>
              <td className="t-radar" onClick={(e) => e.stopPropagation()}><RadarButton compact id={String(b.id)} name={b.name} city={b.city} /></td>
            </tr>
          );
        })}
        {!pro && hidden > 0 && (
          <tr className="t-upsell">
            <td colSpan={COLS.length + 1}>
              <div>
                <b>{hidden.toLocaleString()} more businesses</b> in this table, with owners, banks, email and phone.
                <button type="button" className="btn primary" onClick={() => upgrade("table-rows")}>Upgrade to Pro to see them all</button>
              </div>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
