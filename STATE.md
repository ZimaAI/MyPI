# MyPI implementation state

2026-09-23 — implementation complete; final local verification is recorded in `docs/evidence/implementation.md`. Public release remains gated by the dedicated execution environment.

2026-10-06 — documented model-service catalog added: 16 providers, 18 approved endpoints, 33 model presets shared by Gateway, encrypted storage, CLI and administrator UI. Defaults include protocol, context/output budgets, reasoning settings, official limits and dated sources. Real SDK loopback tests cover all provider defaults across four protocols and thinking/tool-result replay. See `docs/model-providers.md` and the latest entry in `docs/evidence/implementation.md`.

- S0: Official `@earendil-works/pi-coding-agent@0.87.1` installed and locked. Real SDK tests cover native tool replacement, provider schemas, independent sessions, settled/cancel/retry/compaction, private history and disabled project resource discovery.
- S1–S3: Standalone CLI, shared Agent Core, 25 extension tools, tasks/workflows/background/work items, SQLite/Outbox, authenticated Gateway, SSE replay, quota ledger and encrypted model administration implemented and integrated.
- S4: Broker, constrained Docker runner, policy revocation, visitor administration, retention, backup and fail-closed execution implemented. This host lacks the required rootless Docker/runsc environment; public isolation acceptance has not run.
- S5: React chat workspace and six administrator pages implemented against actual APIs. Root `design.md` is the canonical frontend standard. Desktop/mobile, streaming, independent tasks, safe files/Markdown, model administration and rules have browser tests.
- P1: Limited rule drafts, golden validation, immutable publication/rollback and controlled ZIP/public GitHub imports implemented. Imports default off; they require the explicit deployment switch.
- S6: Reproducible local tests, browser fixtures, actual three-service startup/shutdown checks, CI configuration and deployment/evidence documents are provided. See the latest verification record for commands, counts and remaining environment checks.

No paid-provider credential has been supplied. Deterministic loopback HTTP fixtures exercise the real Pi SDK but do not establish model quality, paid cost savings or production performance. The 316-case intent dataset is a regression set, not an independently annotated held-out evaluation. Hosted CI, paid-provider comparisons and dedicated-host SEC acceptance remain NOT_RUN.

The existing Git repository and initial commit are preserved. No credentials, SDK sessions, databases, dependencies or build output belong in version control.
