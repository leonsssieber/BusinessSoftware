# Portfolio strategy — three products, one core, 90 days

## The bet

Build three focused products on one shared platform, validate all three cheaply in parallel,
then put the time into the one customers pull on. This beats guessing because the expensive
part — accounts, teams, billing, AI, email, design system — is built once.

| Product | Pattern | Buyer | Price point | Lead metric |
|---|---|---|---|---|
| **QuoteRunner** | Funded players skip small customers | Owner / purchaser at a 5–50 person contractor or job shop | $149–299 / month | Requests sent per account per week |
| **DryDocs** | Paperwork-heavy profession | Owner / lead tech at a 1–15 tech restoration shop | $79–199 / month | Reports sent to adjusters |
| **AgentFit** | New behavior, proven demand | DevRel, docs or API lead at an API company | $99–399 / month | Test runs per project per week |

QuoteRunner is the lead bet: the largest market, the clearest ROI (materials savings), and the
weakest small-customer competition. AgentFit is the bet that fits a developer founder best.
DryDocs has the hardest competition and the most urgent pain.

## Shared core

Everything that is not product-specific lives in `src/core` (server) and `src/ui` (React):

- Email + password accounts, sessions, password reset, organizations with roles and invites
- Plans and limits per product, Stripe Checkout, Customer Portal and webhooks
- AI calls through the Anthropic SDK with structured JSON output, refusal handling, server-side
  fallbacks, usage metering, and an offline fallback so every feature still works without a key
- Transactional email (Resend in production, a viewable outbox in development)
- Security headers, CSRF origin checks, rate limits, request validation
- A themeable UI kit so each product has its own brand on the same components

Running costs during validation are small: one $5–7/month server per product (or one server
for all three), about $12/year per domain, AI usage in cents per request, and Stripe fees only
on revenue.

## The 90-day plan

### Days 1–14: make each product demo-ready and findable

- Deploy all three on their own domains with the free plan open.
- Publish one useful free tool per product (it doubles as the top of the funnel):
  - QuoteRunner: a free "paste your material list, get a clean RFQ to send to suppliers" page.
  - DryDocs: a free psychrometric calculator (GPP, dew point, grain depression) and an
    equipment calculator.
  - AgentFit: a free "agent test" of any public OpenAPI spec with a shareable score.
- Write the first two pages of content per product (see each product's marketing plan).

### Days 15–45: talk to 15 buyers per product

Each product's marketing plan lists where its buyers are. The goal is conversations, not
signups: watch people use the product and note what they ask for. Offer founder-led onboarding
and a 30-day free pilot to anyone who uses it on real work.

### Days 46–90: charge

Turn pilots into paid plans. Keep shipping what pilots ask for, but only for the products that
show pull.

## Decision rules

Measure every product against the same bar on day 45 and day 90.

| Checkpoint | Keep investing | Put on hold |
|---|---|---|
| Day 45 | ≥ 10 buyer conversations **and** ≥ 3 accounts using it on real work | < 5 conversations or nobody returns after the first week |
| Day 90 | ≥ 3 paying accounts **or** ≥ $500 MRR, and week-4 retention ≥ 50% | No paying account after 3 serious asks |

After day 90, put 70% of the time into the leader, keep one runner-up alive on maintenance,
and pause the third. A paused product keeps its free tool running; it still collects leads.

## Time allocation until day 45

- 50% QuoteRunner, 25% DryDocs, 25% AgentFit.
- One fixed weekly review: conversations held, accounts active, revenue, what users asked for.

## Risks and answers

| Risk | Answer |
|---|---|
| Founder time spread too thin | The shared core makes product work small; the decision rules force focus at day 45 |
| Funded competitor moves downmarket | Win on speed of setup, price, and founder support; small customers value someone they can call |
| AI output errors (wrong price, wrong reading) | Every AI result is a draft the user confirms; the app never sends or bills on AI output alone |
| Running untrusted AI-written code (AgentFit) | Code runs in an isolated child process with no credentials; production runs belong in a no-network container (see `docs/engineering/security.md`) |
| Regulated claims (insurance documentation, procurement terms) | Products assist and document; they do not certify. Terms and disclaimers ship with each app |
