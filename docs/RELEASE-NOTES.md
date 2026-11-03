# Flow v1.23.0 — Release Notes

**Released**: 2026-11-02
**Repositories**: [GitHub](https://github.com/X33834/Flow) · [Gitee](https://gitee.com/badhope/Flow) · [GitCode](https://gitcode.com/badhope/Flow)
**Positioning**: AI-native cross-border commerce platform — buyer storefront plus seller AI workbench.

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
