-- BizEstimate schema (plain Postgres; works as-is on Supabase).

create extension if not exists pg_trgm;   -- fuzzy name search

create table if not exists industry_benchmarks (
  naics_prefix        text primary key,          -- 2- to 6-digit NAICS prefix
  label               text not null,
  payroll_to_revenue  numeric not null,          -- annual payroll / receipts
  revenue_per_employee numeric,                  -- receipts / employees ($)
  ebitda_margin       numeric not null,          -- EBITDA / revenue
  source              text not null
);

create table if not exists businesses (
  id                  bigserial primary key,
  biz_key             text unique not null,      -- normalized name + zip5, used for dedupe
  name                text not null,
  address             text,
  city                text,
  state               text,
  zip                 text,
  county              text,
  naics               text,
  industry            text,                      -- label of the benchmark that matched
  business_type       text,
  is_individual       boolean not null default false,  -- sole prop / self-employed: hide street address
  is_nonprofit        boolean not null default false,
  jobs_reported       integer,
  lat                 double precision,
  lon                 double precision,
  geo_precision       text,                      -- 'address' | 'zip' | null
  -- estimates (dollars, based on the payroll the PPP loan was sized from, ~2019)
  est_payroll         numeric,
  est_revenue_low     numeric,
  est_revenue_mid     numeric,
  est_revenue_high    numeric,
  est_ebitda_low      numeric,
  est_ebitda_mid      numeric,
  est_ebitda_high     numeric,
  est_revenue_by_employees numeric,              -- jobs x industry revenue/employee (primary method)
  est_revenue_by_payroll numeric,                -- PPP-implied payroll / industry ratio (cross-check)
  est_method          text,                      -- 'employees' | 'payroll' | 'owner_earnings'
  est_confidence      text,                      -- 'medium' | 'low'
  total_ppp_amount    numeric,
  search              tsvector generated always as (
    to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(city,'') || ' ' || coalesce(industry,''))
  ) stored
);

-- Columns added after the first release.
alter table businesses add column if not exists est_revenue_by_payroll numeric;
alter table businesses add column if not exists website text;   -- from Overture places (name match)
alter table businesses add column if not exists owner_name text;     -- from the business website (etl/owners.py)
alter table businesses add column if not exists owner_title text;
alter table businesses add column if not exists owner_source text;   -- page the name was found on
alter table businesses add column if not exists source text;         -- 'ppp' (loan data) | 'overture' (places only)
alter table businesses add column if not exists est_ebitda_margin numeric;   -- EBITDA margin applied (IRS, size-adjusted)
alter table businesses add column if not exists est_inflation numeric;   -- price change applied (benchmark year -> now)
alter table businesses add column if not exists est_growth numeric;      -- industry job growth applied (2020 -> now)
alter table businesses add column if not exists phone text;          -- listed number (Overture places)
alter table businesses add column if not exists site_phone text;     -- from the business's own website (etl/owners.py)
alter table businesses add column if not exists site_email text;     -- company address on its own website
alter table businesses add column if not exists contact_page text;   -- page the website contact was found on
alter table businesses add column if not exists parent_key text;         -- a location of this listed company (est_method 'branch')
alter table businesses add column if not exists parent_name text;
-- Search form of the name: upper case, punctuation dropped, single letters joined ("J & K" -> "JK").
alter table businesses add column if not exists name_norm text generated always as (
  regexp_replace(regexp_replace(upper(name), '[^A-Z0-9]+', ' ', 'g'), '\m([A-Z0-9]) (?=[A-Z0-9]\M)', '\1', 'g')
) stored;

create index if not exists businesses_search_idx on businesses using gin (search);
create index if not exists businesses_name_trgm_idx on businesses using gin (name gin_trgm_ops);
create index if not exists businesses_name_norm_trgm_idx on businesses using gin (name_norm gin_trgm_ops);
create index if not exists businesses_city_lower_idx on businesses (lower(city));
create index if not exists businesses_sector_idx on businesses (left(naics, 2));
create index if not exists businesses_latlon_idx on businesses (lat, lon);
create index if not exists businesses_rev_idx on businesses (est_revenue_mid desc);
-- Matches the list's "order by est_revenue_mid desc nulls last", so the top 50 come off the index.
create index if not exists businesses_rev_nl_idx on businesses (est_revenue_mid desc nulls last);
create index if not exists businesses_naics_idx on businesses (naics text_pattern_ops);
create index if not exists businesses_city_idx on businesses (state, city);

create table if not exists ppp_loans (
  loan_number         text primary key,
  business_id         bigint not null references businesses(id) on delete cascade,
  draw                text,                      -- 'first' | 'second'
  date_approved       date,
  amount              numeric,
  payroll_proceed     numeric,
  forgiveness_amount  numeric,
  loan_status         text,
  lender              text,
  jobs_reported       integer
);
create index if not exists ppp_loans_business_idx on ppp_loans (business_id);

-- Owners can claim a listing and submit real numbers (moderated later).
create table if not exists claims (
  id                  bigserial primary key,
  business_id         bigint not null references businesses(id) on delete cascade,
  contact_name        text not null,
  contact_email       text not null,
  message             text,
  reported_revenue    numeric,
  reported_ebitda     numeric,
  request_removal     boolean not null default false,
  created_at          timestamptz not null default now()
);

-- Yearly headcounts from other sources (Form 5500 retirement-plan participants), keyed by biz_key
-- so they survive reloads of businesses. PPP's 2020 headcount stays in businesses.jobs_reported.
create table if not exists headcounts (
  biz_key   text not null,
  year      int not null,
  employees int not null,
  source    text not null,          -- 'form5500'
  ein       text,
  primary key (biz_key, year, source)
);
alter table headcounts add column if not exists naics text;   -- industry code on the employer's filing

-- Public records matched to a business, one JSON object per source (SEC filings, Form 990, FDIC,
-- SBA loans, federal contracts, FMCSA, OSHA, ...). Keyed by biz_key so they survive reloads.
create table if not exists business_sources (
  biz_key    text not null,
  source     text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (biz_key, source)
);

-- Small pieces of pipeline state that must survive cancelled runs (e.g. AI batches in flight,
-- per-site lookup results that cost money), kept in the database rather than a CI cache.
create table if not exists etl_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Page text sent with AI batches still in flight, compressed, so results can be verified against
-- it when collected (by a later run if need be). Rows are deleted as their results are collected.
create table if not exists ai_pending (
  job       text not null,
  batch_id  text not null,
  custom_id text not null,
  site      text not null,
  pages     bytea not null,
  primary key (batch_id, custom_id)
);

-- Actual figures we've been told (owners, people who know the business). Private unless is_public:
-- used to measure and tune estimate accuracy; public ones replace the estimate on the site.
create table if not exists known_financials (
  biz_key    text primary key,
  revenue    numeric,
  ebitda     numeric,
  year       int,
  note       text,
  is_public  boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Contact details: people asking for theirs to be removed or corrected (reviewed in /admin), and
-- businesses whose contact details are hidden as a result.
create table if not exists contact_requests (
  id         bigserial primary key,
  biz_key    text,
  kind       text not null,             -- 'remove' | 'correct' | 'other'
  name       text,
  email      text,
  message    text,
  status     text not null default 'open',   -- 'open' | 'done' | 'dismissed'
  created_at timestamptz not null default now()
);
create table if not exists contact_optouts (
  biz_key    text primary key,
  created_at timestamptz not null default now()
);

-- Owner contact lookups made from /admin with a paid contact-data account (RocketReach). Private:
-- licensed for the account holder's own use, never shown on public pages.
create table if not exists contact_lookups (
  id          bigserial primary key,
  biz_key     text not null,
  provider    text not null,
  person_name text not null,
  provider_id text,
  status      text,
  data        jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (biz_key, provider, person_name)
);

-- "Likely to sell" score (0-100) and the signals behind it (enrich.apply_signals); null where it
-- doesn't apply (public companies, banks, nonprofits, branch locations).
alter table businesses add column if not exists sell_score smallint;
alter table businesses add column if not exists sell_signals jsonb;
create index if not exists businesses_sell_idx on businesses (sell_score desc nulls last, id);
-- A known sale (price and year) for calibrating the valuation multiples; private like the rest.
alter table known_financials add column if not exists sale_price numeric;
alter table known_financials add column if not exists sale_year int;

-- Oklahoma state payments were switched off (almost no private vendors); clear what it saved.
delete from business_sources where source = 'state_payments';

-- Which banks lent to each business (PPP and SBA 7(a)/504 loans), for the lender filter; rebuilt by
-- enrich.apply_lenders after each load. lender_key groups spellings of one bank.
create table if not exists business_lenders (
  business_id bigint not null references businesses(id) on delete cascade,
  lender_key  text not null,
  lender      text not null,
  source      text not null,          -- 'ppp' | 'sba'
  program     text,                   -- 'PPP' | '7(a)' | '504'
  year        int,
  amount      numeric
);
create index if not exists business_lenders_key_idx on business_lenders (lender_key, business_id);

-- Owners entered by hand in /admin: shown publicly and always win over found ones (enrich.apply_owners).
create table if not exists known_owners (
  biz_key     text primary key,
  owner_name  text not null,
  owner_title text,
  note        text,                 -- private: where it came from
  updated_at  timestamptz not null default now()
);
insert into known_owners (biz_key, owner_name, owner_title, note)
select biz_key, 'Don Lavicky', 'Owner', 'D&B and Buzzfile list him as owner; son of founder Charlie Lavicky (est. 1978)'
from businesses where id = 1311985 and name ilike 'lavicky sand%'
on conflict (biz_key) do nothing;
create index if not exists businesses_parent_idx on businesses (parent_key) where parent_key is not null;

-- Your deal pipeline: a status, private notes and a follow-up date per business (admin only).
create table if not exists pipeline (
  biz_key     text primary key,
  status      text not null default 'watching',   -- watching | contacted | talking | passed
  follow_up   date,
  updated_at  timestamptz not null default now()
);
create table if not exists pipeline_notes (
  id          bigserial primary key,
  biz_key     text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists pipeline_notes_biz_idx on pipeline_notes (biz_key, created_at desc);

-- Ownership transactions: acquisitions, PE investments, recapitalizations. Entered in /admin, found in
-- news (etl/deals_news.py) or on investors' portfolio pages (etl/pe_portfolios.py), or SBA-financed purchases.
create table if not exists transactions (
  id          bigserial primary key,
  biz_key     text not null,
  deal_date   date,
  buyer       text not null,
  deal_type   text not null default 'acquisition',  -- acquisition | majority investment | minority investment | investment | recapitalization | merger | management buyout
  price       numeric,                               -- private unless is_public
  multiple    numeric,                               -- EBITDA multiple paid, if known
  summary     text,
  source      text not null default 'admin',         -- admin | news | portfolio
  source_url  text,
  is_public   boolean not null default true,         -- false: shown only in /admin
  created_at  timestamptz not null default now(),
  unique (biz_key, buyer)
);
create index if not exists transactions_date_idx on transactions (deal_date desc);
-- Investors whose portfolio pages are checked for Oklahoma companies (etl/pe_portfolios.py).
create table if not exists investors (
  name        text primary key,
  url         text not null,              -- portfolio page (or homepage; a Portfolio link is followed)
  checked_at  timestamptz
);
insert into investors (name, url) values ('Achieve Capital', 'https://achieve-capital.com/') on conflict do nothing;
insert into transactions (biz_key, deal_date, buyer, deal_type, summary, source, source_url)
select biz_key, '2025-08-01', 'Achieve Capital', 'investment',
       'Strategic investment through Achieve Capital Industrial Fund I (its first investment); terms not disclosed.',
       'news', 'https://achieve-capital.com/achieve-capital-announces-strategic-investment-in-vantage-point-itad-through-industrial-fund-i/'
from businesses where name ilike 'vantage point itad%' and coalesce(est_method, '') <> 'branch'
order by est_revenue_mid desc nulls last limit 1
on conflict (biz_key, buyer) do nothing;

-- Companies known only from public records (unmatched FMCSA carriers, Form 5500 sponsors); load.py
-- lists them at their ZIP. Rewritten per source by etl/records_only.py.
create table if not exists record_listings (
  biz_key text primary key,
  source text not null,
  state text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
