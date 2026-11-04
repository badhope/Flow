# Project Management

How Flow is versioned, branched, verified and released. This document is the
authority for maintainers; contributors only need `CONTRIBUTING.md`.

---

## 1. Versioning

Flow follows [Semantic Versioning 2.0.0](https://semver.org/):

| Change | Version bump | Example |
|---|---|---|
| Breaking API, schema or config change | MAJOR | v1.x.x → v2.0.0 |
| New feature, backwards compatible | MINOR | v1.23.0 → v1.24.0 |
| Bug fix, security patch, dependency bump | PATCH | v1.24.0 → v1.24.1 |

Rules:

- `package.json` `version` is the single source of truth. `README*.md` badges,
  `docs/RELEASE-NOTES.md` and the `CHANGELOG.md` heading must match it.
- A release is a git tag `vX.Y.Z` pointing at the release commit. Tags are
  annotated and pushed to every remote.
- Pre-release identifiers (`v1.24.0-rc.1`) are allowed but must never be pushed
  as `latest` to a package registry.
- Database migrations are additive within a minor line. A migration that drops
  or renames a column requires a MAJOR bump and a documented upgrade path.

### Current line

| Field | Value |
|---|---|
| Version | v1.24.0 |
| Previous stable | v1.23.0 (2026-11-02) |
| Next planned | v1.25.0 — see `docs/ROADMAP.md` |

---

## 2. Branch policy

Single long-lived branch: **`main`**. It is always releasable.

```
main ────●────●────●────●───▶  (tags: v1.22.0, v1.23.0, …)
          ╲   ╱ ╲   ╱
           ● ●   ● ●          short-lived topic branches (deleted after merge)
```

- Topic branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
  They live only until merged, then are deleted locally and on every remote.
- No long-lived `develop`, `release/*` or per-environment branches. The project
  has one deployable artifact; extra branches create drift.
- Hotfixes branch from the tag, merge back to `main`, and produce a PATCH release.
- Rebasing is allowed on a private topic branch; `main` is never force-pushed.

Verify the tree is clean and branchless before a release:

```bash
git branch -a          # only main and remotes/origin/main
git tag --sort=-v:refname
```

---

## 3. Commit convention

[Conventional Commits](https://www.conventionalcommits.org/), imperative mood:

```
<type>(<scope>): <subject>
```

`type` ∈ `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`.
`scope` names the module (`ai`, `payments`, `copilot`, `client`, `docs`, …).

A commit must build and pass unit tests on its own. Multi-step work lands as
several focused commits, not one omnibus change.

---

## 4. Quality gate

Every change must pass, in this order:

| # | Gate | Command | Blocking |
|---|---|---|---|
| 1 | Lint | `npm run lint` | yes |
| 2 | Types | `npm run type:check` | yes |
| 3 | Unit / integration | `npm test` | yes |
| 4 | Build | `npm run build` | yes |
| 5 | Production dependency audit | `npm audit --omit=dev` | yes (high and above) |
| 6 | End-to-end | `npm run smoke:all` | yes |
| 7 | Browser journey | `npm run qa:journey` | yes |
| 8 | Screenshot regeneration | `npm run capture:all` | on UI changes |

The same gates run in `.github/workflows/ci.yml` on every push and pull request
to `main`. Local green without CI green is not "done".

### No fake verification

- A test that cannot fail is deleted. Tests must assert observable behaviour —
  returned values, persisted state, thrown errors, emitted requests.
- Deleting or skipping a test to make a change pass is a blocking review defect.
- Mocks are allowed only at the process or vendor boundary (`mock-providers.mjs`,
  in-memory DB doubles). Mocking the module under test is not allowed.
- A screenshot or E2E suite that passes while the feature is broken is a bug in
  the harness; fix the harness first.

---

## 5. Release procedure

```bash
# 1. Confirm the working tree is clean and up to date
git switch main && git pull --ff-only

# 2. Run the full gate
npm run lint && npm run type:check && npm test && npm run build
npm run smoke:all
npm run qa:journey

# 3. Bump version in package.json and update CHANGELOG.md
#    (move [Unreleased] content into the new version heading)

# 4. Regenerate user-facing assets when the UI changed
npm run capture:all

# 5. Commit and tag
git add -A
git commit -m "chore(release): v1.24.0"
git tag -a v1.24.0 -m "Flow v1.24.0"
git push origin main --tags

# 6. Push mirrors
git push gitee main --tags
# github is pushed only on request (see §6)

# 7. Publish release notes on each platform's Releases page
```

`docs/RELEASE-NOTES.md` is the text used for the release page. Keep it aligned
with the CHANGELOG entry.

---

## 6. Remotes

| Remote | URL | Push policy |
|---|---|---|
| `origin` | gitcode.com/badhope/Flow | primary; every release |
| `gitee` | gitee.com/badhope/Flow | mirror; every release |
| `github` | github.com/X33834/Flow | pushed on explicit request only |

All remotes must point at the same commit on `main`. After a release, verify:

```bash
git ls-remote --heads origin main gitee main
```

A divergence between remotes is a release blocker: reconcile before announcing.

### CI on mirrors

Only the GitHub remote runs Actions. Gitee and GitCode are mirrors of the same
commit; their platform CI is not part of the release gate. Never state that a
mirror's CI is green — say the commit is identical to the verified GitHub one.

---

## 7. Issue and PR hygiene

- Every PR references an issue or states the failure it fixes.
- PRs touching auth, payments, refunds, tenancy or the copilot approval path
  require a second reviewer and an explicit security note.
- A PR that changes an endpoint updates `docs/ARCHITECTURE.md` and, when the
  contract is public, the OpenAPI description in `server/modules/seo/openapi.ts`.
- Dependabot PRs are merged only after the full gate; a green unit suite is not
  enough for a major version bump of a runtime dependency.

---

## 8. Documentation parity

| Document | Language | Must stay in sync with |
|---|---|---|
| `README.md` | English (primary) | `README.zh-CN.md` |
| `README.zh-CN.md` | Chinese | `README.md` |
| `CHANGELOG.md` | English | `package.json` version |
| `docs/RELEASE-NOTES.md` | English | current CHANGELOG heading |
| `docs/ARCHITECTURE.md` | Chinese | actual module and table counts |
| `docs/DEPLOY.md` | Chinese | actual environment variables |

A change that alters counts (tests, endpoints, tables, screenshots) must update
every document that quotes them. Stale numbers are treated as documentation bugs.

---

## 9. Definition of done

A change is done when all of the following are true:

1. The behaviour is implemented and covered by a test that would fail without it.
2. The full quality gate passes locally and in CI.
3. Documentation that quotes affected numbers or behaviour is updated.
4. No new `TODO`, `FIXME`, `as any` or skipped test is introduced without a
   written justification in the PR.
5. The working tree is clean; generated assets (`dist/`, `coverage/`, logs) are
   not committed.
6. Remotes are in sync and the branch list contains only `main`.
