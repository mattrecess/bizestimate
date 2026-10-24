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
