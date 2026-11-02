<div align="center">

<img src="client/src/assets/branding/logo-main.png" alt="Flow" width="220" />

# Flow

### AI-native cross-border commerce platform

**One codebase, two products: a buyer storefront and a seller AI workbench.**

From listing to fulfilment to support to review — the whole operating loop lives here.

[![Version](https://img.shields.io/badge/version-v1.23.0-00C2B8?style=flat-square)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-0B1F3A?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/tests-286%20passing-10b981?style=flat-square)](server)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)

[**English**](README.md) · [**简体中文**](README.zh-CN.md)

[**70-second demo**](docs/video/demo.mp4) · [**Screenshots**](docs/screenshots) · [**Architecture**](docs/ARCHITECTURE.md) · [**Deployment**](docs/DEPLOY.md)

**Mirrors**: [GitHub](https://github.com/X33834/Flow) · [Gitee](https://gitee.com/badhope/Flow) · [GitCode](https://gitcode.com/badhope/Flow)

</div>

![Flow storefront](docs/screenshots/02-homepage-en.png)

---

## What you get

| | Buyer storefront | Seller AI workbench |
|---|---|---|
| **Audience** | Overseas shoppers, four locales (en / zh / es / pt) | Merchants running the store |
| **Core** | Search, filters, SKU variants, cart, coupons, checkout, tracking, refunds, reviews | Dashboard, catalog, orders, refunds, collections, coupons, CMS, audit, AI |
| **AI** | Shopping guide that recommends and confirms before adding to cart | Five specialist agents plus a tool-calling copilot with human approval |

**Works without any AI key.** Every non-AI feature runs normally; AI endpoints return an honest "configure a model" error instead of fabricated data.

---

## Why Flow is different

Most open-source commerce projects ship either a storefront or an admin panel. Flow ships both on one schema — and treats AI as a first-class part of the operating loop rather than a chat widget.

### 1. A copilot that acts, but never acts alone

Ask it to "clear out low-stock items" and it will query low stock, draft a clearance coupon, and unpublish dead SKUs — bundling the whole sequence into **one approval batch** that executes in order and stops on first failure.

```
Seller intent (natural language)
   └─ Agent plans multi-step tool calls
        ├─ read tools  → query this store's real data
        └─ write tools → copilot_actions(status = pending)
              └─ seller approves → existing business services run
                 (state machine, stock, points, audit all stay consistent)
```

- **12 tools** across store overview, orders, products, low stock, pending refunds, status transitions, refund approval, publish/unpublish, coupon creation, draft creation, inquiry replies
- **Strict argument validation** — type, enum, range and length per tool; unknown arguments are rejected, blocking prompt injection and model hallucination
- **Ownership checks** — read tools are seller-scoped, write tools re-verify ownership before executing, admins keep cross-store access
- **Full trace** — conversations, tool results, actions and execution outcomes are persisted

### 2. Five real agents, not five buttons

| Agent | Job | Implementation |
|---|---|---|
| **Copywriter** | Titles, selling points, long copy, SEO keywords | Enforced JSON output, writes back to multilingual fields |
| **Support** | Customer service | FAQ policy match + product retrieval + order summary — answers from real data first |
| **Trend** | Sales analysis | 30-day SQL aggregation + LLM interpretation, reports persisted |
| **Select** | Product selection | Category + top-20 sellers + stock context → structured recommendations |
| **Translation** | Localization | Twelve target languages tuned for cross-border listings |

Each runs through a single gateway that normalizes provider differences (reasoning-model token budgets, response field fallbacks, versioned base URLs). Usage is metered per call, per agent.

### 3. Guard rails that are actually enforced

| Boundary | Behaviour |
|---|---|
| Tenant isolation | Every seller-facing query is scoped; admins retain cross-store views |
| Model config | Keys are stored per `userId:` — no seller can read or overwrite another's |
| Demo payments | Allowed only in `development` / `test`; production returns 403 regardless of flags |
| Outbound requests | Webhook URLs, notification targets and LLM base URLs reject loopback, private, CGNAT, link-local and metadata addresses, with DNS pinning and no redirect following |
| Publish gate | Six completeness checks (images, stock, copy, category, price, variants) before a product can go live |

---

## Screenshots

### Buyer storefront

| Home (English) | Home (Chinese) |
|:---:|:---:|
| ![Home](docs/screenshots/02-homepage-en.png) | ![首页](docs/screenshots/01-homepage-zh.png) |
| **Product list** | **Product detail** |
| ![List](docs/screenshots/03-product-list.png) | ![Detail](docs/screenshots/05-product-detail-en.png) |
| **Cart** | **Checkout** |
| ![Cart](docs/screenshots/06-cart.png) | ![Checkout](docs/screenshots/07-checkout.png) |
| **Order tracking** | **Curated floors** |
| ![Orders](docs/screenshots/08-orders.png) | ![Floors](docs/screenshots/11-collection-floor.png) |

### Seller workbench

| Dashboard | AI copilot |
|:---:|:---:|
| ![Dashboard](docs/screenshots/17-seller-dashboard-en.png) | ![Copilot](docs/screenshots/29-seller-copilot-en.png) |
| **Catalog** | **Orders** |
| ![Catalog](docs/screenshots/18-seller-products.png) | ![Orders](docs/screenshots/19-seller-orders.png) |
| **AI center** | **Refunds** |
| ![AI](docs/screenshots/22-ai-center.png) | ![Refunds](docs/screenshots/20-seller-refunds.png) |

All 31 screenshots live in [`docs/screenshots/`](docs/screenshots). They are regenerated by `npm run capture:all` against a seeded disposable database, so they never drift from the code.

---

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/X33834/Flow.git
cd Flow
cp .env.example .env          # replace JWT_SECRET and POSTGRES_PASSWORD
docker compose up -d --build
```

- Storefront → <http://localhost:3000/>
- Seller workbench → <http://localhost:3000/seller/dashboard>

Compose forces `NODE_ENV=production`; demo seeding is refused there. Use the local workflow below with a throwaway database for demo data.

### Local development

```bash
npm ci
cp .env.example .env   # set DATABASE_URL and JWT_SECRET, NODE_ENV=development
npm run db:migrate
npm run dev            # Vite + NestJS together
```

### Run the full test suite

```bash
npm run lint && npm run type:check && npm test && npm run build
npm run smoke:all      # six end-to-end suites against a real PostgreSQL
```

On a machine with a local PostgreSQL (no Docker), point the runner at a disposable database:

```bash
E2E_DATABASE_URL=postgresql://user:pw@127.0.0.1:5432/flow_e2e_local npm run smoke:all
```

The runner refuses any database whose name does not contain `e2e`, `smoke` or `test`.

### CLI (integration and operations)

```bash
FLOW_BASE=http://127.0.0.1:3000 npm run cli -- health
FLOW_BASE=http://127.0.0.1:3000 npm run cli -- products --limit 5
FLOW_BASE=http://127.0.0.1:3000 npm run cli -- openapi openapi.json
```

---

## Configure AI

Set the model in **Seller workbench → AI center → Model settings**. Changes apply immediately, no restart.

| Field | Notes |
|---|---|
| Base URL | Any OpenAI-compatible endpoint: DeepSeek, Volcano Ark, OpenAI, Qwen, Zhipu… |
| API key | Stored in the database only, masked in the UI, never echoed back |
| Model | e.g. `deepseek-chat`; reasoning models automatically get a larger token budget |

Resolution order: **UI settings → `LLM_*` environment variables → unconfigured (honest error)**.

> `npm run mock:providers` is a local stand-in for Stripe, PayPal and the model endpoint. Its signed callbacks prove the wiring, not vendor sandbox compatibility. Real sandbox acceptance steps are in the [deployment guide](docs/DEPLOY.md).

---

## Engineering

| Dimension | State |
|---|---|
| Types | TypeScript strict; client and server share `shared/api.interface.ts` as the single contract |
| Modules | 25 NestJS modules, 25 controllers, 155 endpoints, 39 tables, 9 SQL migrations |
| Tests | 286 unit/integration cases across 45 files (money, refunds, shipping, state machines, signatures, tenancy, search, SEO, notifications) |
| E2E | Six suites: 16-step workflows, no-key degradation, 19-step transactions, 18-step providers, 19-step copilot, 9-step shopper |
| Browser QA | `npm run qa:journey` walks every buyer and seller route in a real browser and fails on any console error, failed request or missing content |
| CI | lint → typecheck → unit+coverage → production audit → build → Postgres E2E |
| Security | HttpOnly cookie JWT, CSRF header check, per-endpoint rate limits, Stripe/PayPal signature verification, tenant isolation, SSRF and replay protection |
| Observability | Request IDs, global exception redaction, structured errors, AI usage metering |
| Integrations | OpenAPI 3.1 (`/api/openapi.json`), `sitemap.xml`, `robots.txt`, `llms.txt` |

---

## Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  React 19 + Vite + Tailwind + shadcn/ui + ECharts                │
│  Buyer storefront  /            Seller workbench  /seller/*      │
└───────────────────────┬──────────────────────────────────────────┘
                        │ HttpOnly JWT cookie · X-Requested-With
┌───────────────────────▼──────────────────────────────────────────┐
│ NestJS 12 (Express 5) · ValidationPipe · RolesGuard              │
│ Auth · Products · Cart · Orders · Payments · Refunds · Coupons   │
│ Shipping · Collections · CMS · Reviews · Inquiry · Dashboard     │
│ AI (5 agents + gateway) · Copilot (12 tools + approvals)         │
│ Shopper guide · SEO · Audit · Health                             │
└──────────┬──────────────────────────────┬────────────────────────┘
           │                              │
   ┌───────▼────────┐           ┌─────────▼──────────────────────┐
   │ PostgreSQL 16  │           │ OpenAI-compatible LLM endpoint │
   │ Drizzle ORM    │           │ Stripe · PayPal · 17TRACK      │
   │ pg_trgm search │           │ Google OAuth                   │
   └────────────────┘           └────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the schema, AI gateway, copilot protocol and security model.

---

## Design trade-offs

Flow is deliberately a single deployable process over REST, optimizing for transaction correctness and tenant isolation rather than infrastructure breadth.

| Reference | What we borrowed | What we deliberately skipped |
|---|---|---|
| **Medusa / Saleor / Vendure** | Module boundaries, multi-tenancy, composable commerce | No GraphQL rewrite, no heavy container topology |
| **Shopify Hydrogen** | Storefront SEO, sitemap/robots, performance budgets | No platform lock-in: Vite SPA with server-side SEO injection |
| **Dify / FastGPT** | Agent configuration UX, usage panels, retrieval-shaped context | No general-purpose agent platform |
| **Agentic commerce (UCP / ACP / AP2)** | `llms.txt`, machine-readable APIs, narrow capability boundaries | Payment authorization protocols are still immature — ship the read-only discovery layer plus human-approved writes |

**Explicitly out of scope**: multi-tenant SaaS billing, a plugin marketplace, a GraphQL rewrite. Each would dilute the approval-based copilot, which is the actual differentiator.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, database tables, AI gateway, copilot protocol, security model |
| [docs/AI-AGENTS.md](docs/AI-AGENTS.md) | Five agents, custom agents, copilot tools and degradation behaviour |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deployment, secret list, backup and upgrade, troubleshooting |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What shipped, what is next, what is out of scope |
| [docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md) | Current release notes and known limits |
| [CHANGELOG.md](CHANGELOG.md) | Version history (Keep a Changelog) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution flow and code style |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |

---

## Project status

| Item | Value |
|---|---|
| Current version | **v1.23.0** |
| State | Feature-complete and maintained: bug fixes, security patches, dependency upgrades |
| CI | GitHub Actions runs lint, typecheck, unit tests with coverage, production audit, build and six Postgres E2E suites |
| Tests | 286 / 286 across 45 files |
| Licence | MIT |

---

## Contributing

Issues, PRs and documentation fixes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first.

If Flow is useful to you, a **star** is the best support.

## Licence

[MIT](LICENSE) © 2026 Flow
