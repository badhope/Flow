# Flow v1.24.0 — Release Notes

**Released**: 2026-11-04
**Repositories**: [GitHub](https://github.com/X33834/Flow) · [Gitee](https://gitee.com/badhope/Flow) · [GitCode](https://gitcode.com/badhope/Flow)
**Positioning**: AI-native cross-border commerce platform — buyer storefront plus seller AI workbench.

## What this release is about

v1.24.0 is about **not losing money, not hanging forever, and not lying to integrators**.
Every change below traces to a specific failure path that was reachable before.

### 1. Money paths are now idempotent

| Before | After |
|---|---|
| Provider refund called, then the DB transaction ran. A crash in between left money refunded with no local record. | Provider refund id + `provider_state` are persisted **immediately**, before the business transaction. A failed write can be reconciled instead of retried. |
| Retrying a timed-out refund could refund twice. | Stripe receives `Idempotency-Key`, PayPal receives `PayPal-Request-Id`, derived from the refund id. |
| Double-clicking "place order" could create two orders and decrement stock twice. | `orders.idempotency_key` with a partial unique index; the checkout page generates one key per session and reuses it. |

Verified against a real PostgreSQL: two submissions with the same key return the
same `orderNo`, and only one row exists in `orders`.

### 2. Approvals can no longer hang or go stale

`copilot_actions` gained four columns and a watchdog:

- `expires_at` (24 h) — expired approvals refuse to execute.
- `lease_until` — a crashed process leaves a reclaimable lease instead of a permanent `processing` row.
- `policy_snapshot` — a fingerprint of the tool definition at approval time; if the tool changes, the old approval is invalidated.
- `idempotency_key` — the same tool + args in one conversation yields one card, not duplicates.
- `CopilotActionReaperService` sweeps every 60 seconds.

### 3. Agents can connect — read-only, by design

`POST /api/mcp` implements **MCP over Streamable HTTP** (JSON-RPC 2.0). It exposes
five read tools with JSON Schema and standard `annotations`. Write tools return
`-32602` with an explicit reason: money-moving actions require a human at the
approval card.

`GET /.well-known/agent-card.json` publishes an A2A-style capability card so
external agent frameworks can discover the endpoint without reading docs.

Both were verified with live `curl` against a running instance.

### 4. One tool contract, four consumers

`copilot-tool-contract.ts` is now the single source for the model catalog, the
approval UI risk badges, the MCP `inputSchema`, and the OpenAPI tool schema. The
hand-maintained `TOOL_META` table in `ApprovalCard.tsx` is gone — it could drift
into showing a high-risk action as medium.

### 5. AI gateway grew up

- Retry with exponential backoff on 429/408/5xx/network errors, honouring `Retry-After`; 401/404 fail fast.
- Cost accounting per call with separate input / output / cached-input rates. Unlisted models return `null` and render as "not priced" instead of a fabricated `$0.00`.
- Task-level model routing (`resolveTaskModel`) so a cheap model can handle titles while a strong one writes long copy.

### 6. Documentation told the truth

- The storefront claimed four product locales; product copy is actually `en` + `zh`, with `es`/`pt` falling back. README now says so.
- OpenAPI `info.version` was pinned at `1.22.0` while `package.json` said `1.23.0`; both now track the release.
- Absolute URLs in `sitemap.xml`, `llms.txt` and the agent card fell back to `localhost:3000` whenever `APP_URL` was unset; they now derive from the request (`Host` + `X-Forwarded-Proto`).

## Verification

| Gate | Result |
|---|---|
| `npm run lint` | 0 problems |
| `npm run type:check` | 0 errors, both projects |
| `npm test` | 349/349 across 52 files |
| `npm run build` | Client + server build |
| `npm run smoke:all` | 6/6 suites against PostgreSQL 16 |
| `npm run qa:journey` | 30 routes, 0 console errors, 0 failed requests |
| Live MCP probe | `initialize` / `tools/list` / `tools/call` / write-tool rejection all as specified |

## Known limits

- Copilot is still request/response; no SSE streaming yet.
- No eval gate: prompt changes rely on unit tests and E2E, not a golden set.
- `trace_id` is stored but not exported over OpenTelemetry.
- Cost is measured but not budget-capped per tenant.
- Customer-service context still includes receiver details; no pre-model PII redaction.

---

## Historical: v1.23.0

## What this release is about

No new product surface. v1.23.0 makes the platform **provably runnable outside
the author's machine** and makes the repository self-describing for everyone who
clones it — developers, operators, buyers of the code, and coding agents.

### 1. Verification that survives a different OS

The six E2E suites used to depend on the `embedded-postgres` binary, which
refuses to start under a Windows administrator account. The runner now accepts
`E2E_DATABASE_URL` and runs against any reachable PostgreSQL, while a name guard
(`assertDisposableDatabase`) refuses to reset a database that does not look
disposable. The full suite was executed against PostgreSQL 16.15 on Windows for
this release.

### 2. Real-browser QA as a gate

Two new scripts drive a real browser instead of calling the API directly:

- `qa:journey` visits all 19 buyer and seller routes, failing on any console
  error, failed request, page error or missing content.
- `qa:purchase` walks the purchase path with visible controls: product list →
  detail → add to cart → cart → checkout → orders.

### 3. Screenshots that match reality

Full-page captures previously shipped blank product tiles because lazy-loaded
images below the fold never decoded. The capture pipeline now scrolls each page,
waits for every image, and fails the whole run if any image is broken. All 31
screenshots and the demo video were regenerated from a real PostgreSQL run.

### 4. Documentation parity

`README.md` is now the English primary page with a language switcher;
`README.zh-CN.md` is a full Chinese counterpart. `docs/PROJECT-MANAGEMENT.md`
records versioning, branch policy, the quality gate, the release checklist and
the multi-remote procedure.

## Verification record

| Gate | Result |
|---|---|
| `npm run lint` | 0 problems |
| `npm run type:check` | 0 errors, client and server |
| `npm test` | 286/286 across 45 files |
| `npm run build` | server and client built |
| `npm audit --omit=dev` | 0 vulnerabilities (official npm registry) |
| `npm run smoke:all` | 6/6 suites on PostgreSQL 16.15 |
| `npm run qa:journey` | 19 routes, 0 console errors, 0 failed requests |
| `npm run capture:all` | 31 screenshots, 0 decode failures, demo video regenerated |

## Upgrade notes

1. No database migration in this release.
2. `E2E_DATABASE_URL` is optional; without it the embedded PostgreSQL path is
   unchanged.
3. `smoke:all` now validates the database name before resetting it. A database
   named `flow` or `production` will be refused by design.
4. Screenshot and video assets changed; re-pull them if you mirror the
   documentation.

## Known limits (stated honestly)

- Real-provider sandbox acceptance is **not** done: Stripe test mode, PayPal
  sandbox capture, PayPal webhook signature compatibility, 17TRACK live tracking
  and SMTP delivery all remain pending. Steps are documented in
  `docs/DEPLOY.md` §8.
- No Region, multi-currency or tax engine; prices are USD only.
- No vector retrieval: the support agent uses `pg_trgm` keyword recall.
- 17TRACK returns a demo timeline when no API key is configured; the UI labels it.
- `npm run format:check` is not a gate: legacy files are not fully formatted.
- `qa:journey` and `qa:purchase` require a browser binary; they are not part of
  the default CI job.
