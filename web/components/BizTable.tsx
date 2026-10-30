"use client";
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
  { label: "Owner", cls: "hide-md" },
  { label: "Sale signs", sort: "sell_desc", num: true },
];

// The search as a spreadsheet-style table: every column at a glance, sortable from the headers.
export default function BizTable({ rows, sort, onSort, onOpen, selectedId }: {
  rows: Biz[]; sort: string; onSort: (sort: string) => void; onOpen: (id: number) => void; selectedId: number | null;
}) {
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
        {rows.map((b) => {
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
              <td className="hide-md">{b.owner_name ?? <span className="t-muted">—</span>}</td>
              <td className="num">{sell >= 20 ? <span className={`badge ${sell >= 40 ? "warn" : ""}`}>{sell}</span> : <span className="t-muted">—</span>}</td>
              <td className="t-radar" onClick={(e) => e.stopPropagation()}><RadarButton compact id={String(b.id)} name={b.name} city={b.city} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
