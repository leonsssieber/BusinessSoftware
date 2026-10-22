# QuoteRunner — scaling plan

Scale in stages, and only move to the next stage when the current one's exit condition is met.

## Stage 1: 0 → 10 paying accounts (founder-led)

- One trade (electrical), one or two regions, founder does every sale and onboarding.
- Product work comes only from pilot requests. Ship weekly.
- **Exit condition:** 10 paying accounts, week-4 retention ≥ 50%, at least 3 accounts with a
  savings number they're willing to share.

## Stage 2: 10 → 100 accounts (repeatable channels)

**Go to market**

- Turn the best pilot stories into case studies and use them in outreach, association talks and
  the landing page.
- Pick the one or two channels from the marketing plan that produced activated accounts at the
  lowest founder time per account; double them. Drop the rest.
- Add the second trade (plumbing/HVAC) with its own landing page, example list and templates.
- Self-serve onboarding: an in-app checklist, sample data, and a 3-minute video per step, so
  most accounts activate without a call.
- First hire (part-time): customer success/onboarding, ideally someone who has worked a supply
  house counter or as a contractor's buyer.

**Product**

- QuickBooks Online and Xero sync for POs and bills (the most likely "must have" for paying
  customers; validate first).
- SMS quote links; supplier-side reminders by text.
- Approvals for POs over an amount; roles for PMs who request but can't award.
- Reorder at last price; simple per-supplier catalogs built from past quotes.

**Revenue**

- Expansion via seats (Team plan) and higher limits.
- Annual plans pushed at the 60-day mark when savings are visible.
- Raise list prices for new customers once case studies exist; keep founding customers'
  prices.

## Stage 3: 100 → 1,000 accounts (sales-assisted, network effects)

**Supplier network.** By now thousands of supplier contacts have answered on QuoteRunner
links. Give suppliers a free dashboard of all requests they receive from QuoteRunner customers
in one inbox. Suppliers then pull more of their customers in ("send me your lists through
QuoteRunner"), which turns the footer loop into a real acquisition channel. Keep the buyer
first: suppliers never see competitor prices, and nothing is paid placement.

**Data.** With customer opt-in, aggregate anonymised prices into benchmarks ("electrical
contractors in your area paid 6% less for this item last month"). That is a feature no
single-customer tool can copy, and a reason to stay.

**Sales.** Add an inside sales rep for Team accounts and multi-location companies; keep
everything under $300/month self-serve.

**Markets.** English-speaking markets first (US, Canada, UK, Australia, Ireland, New Zealand):
add metric units, currency per company, and VAT/GST fields on POs. Each market launches with
the trades that worked at home.

## Technical scaling

The current stack runs on one server: Node, SQLite in WAL mode, in-process jobs and in-memory
rate limits. That comfortably serves the first few hundred accounts. Change only what load
actually demands:

| Pressure | Change |
|---|---|
| Many concurrent writers / more than one server | Move from SQLite to Postgres. SQL lives in the repo modules behind the `Db` helper, so the move is mechanical. |
| More than one server | Move rate limits and job locks to Redis or Postgres; run the reminder job on one worker. |
| PDF and attachment volume | Keep files in object storage (S3/R2) instead of the database. |
| Inbound email volume | Postmark or SES inbound webhooks (the endpoint already accepts Postmark's payload). |
| AI cost | System prompts are marked for prompt caching (it takes effect once a prompt passes the model's minimum cacheable length); route list parsing and quote reading to the cheapest model that passes a quality check on real supplier PDFs (your decision; `ANTHROPIC_MODEL`). Use the Batch API for non-urgent re-reads. |
| Reliability | Error tracking, uptime checks on `/api/health`, nightly database backups to object storage with a tested restore. |

## Team plan

| ARR | Team |
|---|---|
| $0–150k | Founder + part-time onboarding help |
| $150k–500k | + 1 engineer, + 1 customer success, + part-time content/SEO |
| $500k–1.5M | + inside sales for Team/multi-location, + 1 engineer for integrations |

## Moats, in the order they form

1. **Workflow:** POs, price history and supplier records live in QuoteRunner; switching means
   losing them.
2. **Supplier network:** suppliers already know the link and answer faster.
3. **Price data:** opt-in benchmarks get better with every customer.

## Exit options (for later, not a plan)

Natural acquirers: construction and field-service software companies (Procore, ServiceTitan,
Buildertrend), accounting platforms serving trades, and large distributors (Wesco, Graybar,
Ferguson) that want a direct relationship with small buyers.
