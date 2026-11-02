# Maintainers

## Roles

| Role | Responsibility | Required for |
|---|---|---|
| **Maintainer** | Architecture decisions, release tagging, remote pushes, final merge | Every release; any change to auth, payments, tenancy |
| **Reviewer** | Code review, test adequacy, documentation parity | Every pull request |
| **Contributor** | Issues, pull requests, documentation and examples | — |

The canonical list of current maintainers is the commit history plus
`CODEOWNERS`. Adding or removing a maintainer requires a pull request merged by
an existing maintainer.

## Review expectations

| Change type | Reviewers | Extra requirement |
|---|---|---|
| Documentation, typo, comment | 1 | none |
| Client UI, layout, copy | 1 | screenshots regenerated if visible |
| Server module, endpoint, DTO | 1 | endpoint documented in `docs/ARCHITECTURE.md` |
| Auth, payments, refunds, tenancy, copilot approvals | 2 | explicit security note in the PR body |
| Migration, schema change | 2 | upgrade path and rollback note |
| Dependency major bump | 2 | full quality gate + `npm audit` output in the PR |

## Release authority

Only a Maintainer may:

- push a version tag;
- push to the `github` remote;
- merge a change that touches payment or tenancy code;
- declare a release "verified" (which requires the evidence table in
  `docs/PROJECT-MANAGEMENT.md` §4 to be complete).

## Response expectations

| Channel | Target |
|---|---|
| Security report | Acknowledge within 72 hours |
| Bug report with reproduction | Triage within 7 days |
| Pull request | First review within 7 days |
| Release-blocking regression | Acknowledge within 24 hours |

These are targets, not contractual SLAs; this is a volunteer-maintained project.

## Decision making

- Day-to-day: lazy consensus on the pull request.
- Architecture, data model, authentication, deployment topology: open an issue
  first, reach consensus, then implement.
- Breaking changes: require a migration path and a `Changed` / `Removed` entry in
  `CHANGELOG.md`.
- Deadlocks are resolved by the Maintainer of the affected area; if none is
  active, the repository owner decides.

## Stepping down

A maintainer who has been inactive for six months may be moved to emeritus by
consensus of the active maintainers. Emeritus maintainers keep credit and lose
merge rights.
