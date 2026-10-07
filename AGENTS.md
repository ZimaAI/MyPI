# MyPI implementation rules

Read `design.md` before every frontend change. It is the canonical implementation design system; the original product reference is `docs/MyPI/design.md`.

Read `STATE.md` and `docs/evidence/implementation.md` before resuming implementation. Product requirements remain in `docs/MyPI/docs/`.

- Implement backend behavior before adding the corresponding frontend interaction.
- Only `native` and `explicit` modes. Extensions are authorized per human Run.
- Pi SDK imports belong only in `packages/pi-adapter`. Core does not depend on Gateway or UI.
- Web execution always uses the isolated Broker. Never substitute `TrustedLocalSandbox` outside explicitly trusted CLI or test code.
- Do not enable public execution unless dedicated-host security acceptance passes. Model or sandbox failure must remain a visible failure.
- User-authorized exception: localhost-only Docker Desktop may use the explicit local Docker Broker profile with runc, no network/host mounts in task containers, immutable images and resource limits. This is not public-host isolation acceptance; public profiles must reject local-only Broker health. Keep Docker control access exclusive to the Broker service.
- Use `pnpm format` for source formatting. Use `pnpm verify` and targeted browser tests for affected user flows. Do not commit credentials, runtime data, build output, or dependencies.
- Use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## CodeGraph

If `.codegraph/` exists at the repository root, use CodeGraph before searching or reading code to locate symbols. Otherwise do not create an index automatically.
