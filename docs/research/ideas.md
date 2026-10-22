# Idea research — October 2026

This document records how the three products in this repository were chosen, which other
ideas were evaluated, and why they were dropped. All competitor and market claims link to the
source they came from. Vendor numbers are vendor numbers; treat them as directional.

## What we were looking for

The brief: software people will pay for monthly, in a market that is not saturated, with a
clear way to market and scale it. The founder is a developer.

Each idea was scored 1–5 on:

| Criterion | What a 5 means |
|---|---|
| Market size | Hundreds of thousands of potential paying customers, or fewer customers with large budgets |
| Pain / urgency | Customers lose money or face a deadline if they do nothing |
| Willingness to pay | Customers already pay for worse alternatives (people, spreadsheets, legacy software) |
| Openness | No dominant player; funded competitors ignore the target segment |
| Founder fit | A developer can build it and reach the buyers without a big sales team |
| AI leverage | AI does work that was impossible or expensive before 2024 |

## The main finding

In late 2026 almost every software niche has at least a few entrants. AI made building cheap,
so obvious ideas fill up fast:

- A study of 30,000+ Stripe-accepting companies reports a **median MRR of about $7 for generic
  AI tools** — a crowded category where most products earn almost nothing
  ([BigIdeasDB](https://bigideasdb.com/saas-market-saturation-2026)).
- Even narrow developer niches have several tools. LLM model-deprecation scanning, for
  example, already has a hosted GitHub App with a Pro plan listed at about $5/year
  ([LLM Status](https://llmstatus.ai/), [pricing listing](https://toolradar.com/tools/llm-status/pricing))
  plus several open-source scanners
  ([llm-eol](https://github.com/binhna/llm-eol),
  [Chowkidar](https://github.com/marketplace/actions/chowkidar-llm-deprecation-watchdog)).

So "not saturated" in 2026 means one of these:

1. **Funded players sell upmarket and skip small customers.** The small customers still use
   phone, email and spreadsheets.
2. **A professional workflow that is mostly paperwork**, where AI now does hours of work and the
   buyers sit outside tech circles.
3. **A brand-new behavior** where demand is proven but only one or two companies exist yet.

The three chosen products map to these three patterns.

## The shortlist

| # | Idea | Size | Pain | WTP | Openness | Fit | AI | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | **QuoteRunner** — AI purchasing agent for small contractors and shops | 5 | 4 | 4 | 4 | 4 | 5 | **Build (lead bet)** |
| 2 | **DryDocs** — AI drying documentation for water-damage restoration | 3 | 5 | 4 | 2 | 3 | 4 | **Build (second bet)** |
| 3 | **AgentFit** — test whether AI coding agents can use your API | 3 | 3 | 4 | 3 | 5 | 5 | **Build (developer bet)** |
| 4 | NextOwner — exit readiness for retiring owners | 5 | 3 | 4 | 4 | 2 | 4 | Dropped by founder |
| 5 | EU Cyber Resilience Act kit for small makers | 4 | 5 | 4 | 2 | 3 | 3 | Dropped by founder |
| 6 | Family caregiving coordinator | 5 | 4 | 2 | 3 | 3 | 3 | Dropped by founder |
| 7 | Scope-creep detector for freelancers | 4 | 3 | 3 | 1 | 4 | 4 | Crowded |
| 8 | Security scanner for vibe-coded apps | 4 | 3 | 3 | 1 | 5 | 3 | Crowded |
| 9 | LLM model / API deprecation radar | 4 | 3 | 1 | 1 | 5 | 3 | Crowded, near-zero prices |
| 10 | Contract-renewal tracker for SMBs | 4 | 3 | 3 | 2 | 4 | 4 | Crowded |
| 11 | EU pay-transparency tool for SMBs | 4 | 4 | 3 | 2 | 3 | 3 | HR suites already cover it |
| 12 | AI home inventory for insurance claims | 5 | 3 | 2 | 2 | 4 | 4 | Crowded consumer niche |
| 13 | Knowledge capture before employees retire | 4 | 3 | 4 | 3 | 3 | 4 | Early players exist |
| 14 | AI writer for environmental site assessments | 2 | 4 | 5 | 3 | 2 | 4 | Small market, domain-heavy |
| 15 | AI for HOA reserve studies | 2 | 3 | 4 | 2 | 2 | 3 | Several 2025–26 launches |

## Notes on the three chosen products

### 1. QuoteRunner — AI purchasing agent for small contractors and machine shops

**Problem.** A small electrical contractor or job shop buys materials for every job from three
to ten local suppliers. Today someone phones or emails each supplier, waits, chases, gets
answers back as PDFs, emails and spreadsheets, then compares them by hand — or skips the
comparison and pays whatever the usual supplier charges.

**Why it's open.** The money in AI procurement is going upmarket:

- Didero raised a $30M Series A in February 2026 (about $37M total) for agentic procurement at
  manufacturers and distributors, with 30+ deployments
  ([TechCrunch](https://techcrunch.com/?p=3092627),
  [Yahoo Finance](https://finance.yahoo.com/news/didero-lands-30m-put-manufacturing-203147593.html)).
- Kojo has raised about $94M and serves 600+ commercial contractors who buy $5B+ of materials
  a year through it; Wesco, the largest US electrical distributor, invested $10M in 2025
  ([Distribution Strategy](https://distributionstrategy.com/2025/09/kojo-secures-10-million-investment-from-wesco-expanding-construction-tech-platform/)).
- Arkestro and Keelvar sell AI-run RFQs and sourcing bots to enterprise procurement teams.
- At the low end there are generic agents such as Hostinger's procurement agent and Buyer24,
  not built around trade line items, supplier portals or job need-by dates
  ([Hostinger](https://www.hostinger.com/procurement-ai-agent),
  [Buyer24](https://aiagentsdirectory.com/agent/buyer24)).

Small contractors (5–50 people) and job shops are left with phone and email.

**Market.** US specialty trade contractors employ about 3.9 million people
([BLS](https://www.bls.gov/ces/data/employment-and-earnings/2022/table6b_202211.htm)). Canada
alone counts 164,896 specialty-trade businesses, and materials plus subcontracts average
about 37.6% of their revenue
([Statistics Canada](https://ised-isde.canada.ca/app/ixb/cis/performance/238)). A contractor
with $3M revenue therefore buys roughly $1M of materials a year; saving 3% is $30,000.
Forrester expects 1 in 5 B2B sellers to face AI buyer agents in quote negotiations by the end
of 2026 ([via Origami](https://origami-marketplace.com/en-gb/agentic-commerce-b2b-ai-purchasing-marketplace/)).

### 2. DryDocs — AI drying documentation for small restoration companies

**Problem.** Insurers and third-party administrators pay water-mitigation invoices only when
the drying is documented: moisture maps, daily psychrometric readings, equipment logs, photos
and a narrative that justifies every equipment day. Technicians hate the paperwork, and weak
documentation gets invoices cut.

**Why it's only partly open.** This is the most competitive of the three. Encircle includes
its drying module Hydro at no extra cost for customers
([Encircle](https://getencircle.com/news/encircle-officially-launches-hydro-to-simplify-restorative-drying)),
and Albi, DASH, Xcelerate, PSA, MICA, ECodeFX, Clean Claims and FieldCamp all cover parts of
the workflow ([2026 tools guide](https://agiled.app/blog/best-tools-for-restoration-companies),
[ranking](https://wifitalents.com/best/water-restoration-software/)). The opening is narrower:
an AI-first documentation copilot for 1–15 technician shops, priced below the suites, focused on
one outcome — documentation an adjuster cannot argue with.

**Market.** IBISWorld counts 57,615–62,582 US damage-restoration businesses and a $7.2–7.7B
market ([market size](https://www.ibisworld.com/united-states/industry/damage-restoration-services/6278/),
[business count](https://www.ibisworld.com/industry-statistics/number-of-businesses/damage-restoration-services-united-states)).
Typical restoration software costs $50–$300 a month per company
([tools guide](https://agiled.app/blog/best-tools-for-restoration-companies)).

### 3. AgentFit — can AI coding agents actually use your API?

**Problem.** In 2026 most new API integrations are written by coding agents such as Claude
Code, Codex and Cursor. If an agent invents an endpoint, uses a deprecated SDK method or forgets
authentication, the developer gives up and picks a competitor. API companies cannot see this
happening.

**Why it's open, and the risk.** Demand is validated but the category is months old:

- Lightsage raised a $4M seed in September 2026 to run coding agents against products and find
  where they fail; customers include Firecrawl, Reducto and Daytona
  ([HackerNoon](https://hackernoon.com/lightsage-raises-$4m-led-by-nexus-to-build-the-growth-stack-for-ai-agents),
  [Dealroom](https://dealroom.co/news/149407-lightsage-raises-4m-to-help-software-makers-sell-to-ai-agents/)).
- Microsoft published an "agent experience" testing method; in its case study a CLI hint
  raised agent success from 30 of 80 checks to 75 of 80
  ([summary](https://windowsforum.com/news/microsoft-agent-experience-how-to-test-ai-coding-agents-for-sdk-api-and-cli-success.447341/)).
  Stainless and Vercel write about the same problem
  ([Stainless](https://www.stainless.com/blog/steps-toward-great-agent-experience-every-api-provider-can-take-today/),
  [Vercel](https://vercel.com/blog/how-we-built-aeo-tracking-for-coding-agents)).
- **Static "agent readiness" checkers are already free** — Cloudflare, Fern and others score
  docs pages ([Cloudflare](https://blog.cloudflare.com/agent-readiness/),
  [Fern](https://labs.buildwithfern.com/)). So the product must go further: actually run models
  against the API spec and show exactly which calls fail and why.

**Market.** In Postman's 2025 survey of 5,700+ API professionals, 82% use some API-first
development, 65% earn revenue from APIs, 89% use generative AI, but only 24% design APIs for AI
agents ([Nordic APIs summary](https://nordicapis.com/a-deep-dive-into-the-state-of-the-api-2025/)).

## Ideas that were dropped, with evidence

- **NextOwner (exit readiness for small business owners).** Strong demographics — Germany
  alone expects about 109,000 succession requests a year until 2029 and has 2M+ owners aged 55+
  ([KfW](https://www.kfw.de/PDF/Download-Center/Konzernthemen/Research/PDF-Dokumente-Fokus-Volkswirtschaft/Fokus-2026/Fokus-Nr.-526-Januar-2026-Nachfolge-Monitoring.pdf)) —
  and the incumbent Value Builder System is sold only through advisors
  ([ActionCOACH](https://actioncoach.co.uk/about/find-value-business-2//)). Rowan raised a
  $3.3M seed for AI succession in March 2026
  ([PR Newswire](https://www.prnewswire.com/news-releases/rowan-raises-3-3m-in-seed-funding-to-modernize-small-business-succession-with-ai-302730088.html)).
  The founder preferred other directions; it remains a good idea for someone with access to
  business owners.
- **EU Cyber Resilience Act compliance kit.** Reporting duties went live on 11 September 2026
  ([ENISA](https://www.enisa.europa.eu/news/the-cra-single-reporting-platform-is-launched)), but
  at least a dozen vendors appeared within a year, from free (OSCRAT,
  [Unicis](https://www.unicis.tech/frameworks/cra/)) to €399+/month
  ([Venvera](https://venvera.com/best/cra-compliance-software)) and €2,500–15,000/year
  ([Regulus](https://goregulus.com/)).
- **Family caregiving coordinator.** Real pain, but most tools are free and consumers pay little
  ([overview](https://joingerald.com/learn/life--lifestyle/affordable-expense-sharing-apps-family-caregivers)).
- **Scope-creep detection for freelancers.** At least five products already: Stria,
  ScopeAuditor, Boundly, ScopeGuard Pro and others
  ([Stria](https://marketplace.microsoft.com/product/web-apps/automatalabs.get_stria),
  [ScopeAuditor](https://www.stork.ai/en/scopeauditor),
  [Boundly](https://www.indiehackers.com/product/boundly-2)).
- **Security scanners for vibe-coded apps.** The problem is real — one vendor found issues in
  1,046 of 1,072 scanned Supabase apps
  ([Symbiotic Security](https://www.symbioticsec.ai/blog/we-scanned-1-072-vibe-coded-apps-98-had-security-flaws)) —
  but free scanners already exist ([Bleek](https://www.producthunt.com/p/bleek-dev/bleek-dev)).
- **Third-party API deprecation monitoring.** DeprecationWatch, Deprecatr AI, Changes.Watch and
  PageCrawl all cover it ([DeprecationWatch](https://www.deprecationwatch.com/),
  [Deprecatr AI](https://www.deprecatrai.com/),
  [Changes.Watch](https://www.changes.watch/deprecations)).
- **Contract-renewal tracking.** Covered by Spendflo's agent, workflow templates and even a free
  Anthropic skill ([Spendflo](https://www.spendflo.com/agents/ai-agent-for-contract-renewal)).
- **EU pay transparency for SMBs.** HR suites and specialists already sell it
  ([Trusaic buyer's guide](https://trusaic.com/resources/best-eu-pay-transparency-directive-software/)).
- **AI home inventory.** HomeZada, NovaTrak, ClaimTally, Hometric and Bevel
  ([HomeZada](https://homezada.com/press/homezada-launches-home-inventory-video-recognition-ai),
  [NovaTrak](https://www.qorusglobal.com/innovations/31050-novatrak)).
- **Knowledge capture before retirement.** Sensay launched an AI offboarding platform in
  November 2025 ([Barchart](https://www.barchart.com/story/news/36018738/sensay-launches-worlds-first-ai-offboarding-platform-for-knowledge-transfer)).
- **Environmental site assessment writing.** Firms build their own tools; the market is small
  and specialized ([Environment Journal](https://environmentjournal.ca/lessons-learned-ai-for-writing-specialized-technical-reports/)).
- **HOA reserve studies.** Several AI launches in 2025–2026
  ([overview](https://gitnux.org/best/reserve-study-software/)).

## Why build three at once

The three products share most of their plumbing — accounts, teams, billing, AI calls, email and
the UI kit live in one core (`src/core`, `src/ui`). Each extra product costs a fraction of the
first. Running three cheap validation sprints in parallel and then putting the time into the
one that gets traction is safer than betting everything on one guess. The decision rules are
in [the portfolio strategy](../strategy/portfolio.md).
