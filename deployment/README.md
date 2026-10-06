# Deployment

## Local Docker Desktop

From the repository root, with Docker Desktop running Linux containers:

```sh
node scripts/setup-docker.mjs
docker compose up -d --build --wait
```

Open http://localhost:3000 (use this exact origin for cookie/CSRF validation).
Compose publishes only `127.0.0.1:3000`. Nginx proxies to the local-profile
Gateway; Gateway, Worker and Broker share a private container network namespace
and retain their loopback listeners. The application runs as the non-root `node`
user. No Docker socket or host project directory is mounted into the application.

Secrets are generated once in ignored `.env.docker`. Keep this file when updating:
the master key is required to decrypt saved model configuration. SQLite, private
SDK state and Broker workspaces persist in the `mypi_state` named volume.
There is no default administrator. To create one interactively:

```sh
docker compose exec app node --import tsx apps/cli/src/main.ts admin bootstrap --state-dir /data/server
```

`docker compose logs --tail=100` shows service output. Use `docker compose stop`
to stop gracefully and `docker compose up -d --wait` to start again. Use
`docker compose down` to remove containers while retaining data; adding `-v`
also destroys the database/workspaces. Back up the volume and `.env.docker`
together while services are stopped. A forced kill can leave `worker.lock`:
only remove that file after confirming the old Worker is stopped.

This local deployment supports the UI, guest sessions, conversations and template
files. Execution and optional imports remain explicitly disabled. `/health/live`
returns 200, while `/health/ready` returns 503 until the execution release gate is
met. The expected Broker orphan-cleanup warning reflects the deliberately absent
Docker socket/CLI. Docker Desktop deployment does not satisfy that release gate;
do not enable execution here or substitute a trusted-local runner.

The public execution switch defaults to **off**. The broker has no host execution fallback. A running Docker Desktop installation is not evidence of production isolation.

Use Node.js 24+, the committed package lock, one Gateway and one Worker. Build the frontend with `pnpm build`. Configure Nginx using `deployment/nginx.conf`, adjusting the actual static output path and domain. Only Nginx may expose a public port. Gateway, Worker and Broker remain private. Keep their private state outside every project workspace. Supply separate secrets at runtime; never mount model credentials into code containers.

## Sandbox build

```sh
pnpm exec tsc -p deployment/tsconfig.sandbox.json
docker build -f deployment/Dockerfile.sandbox -t mypi-sandbox:1.0.0 .
# Push to your controlled registry, then inspect its immutable RepoDigest.
docker image inspect mypi-sandbox:1.0.0 --format '{{json .RepoDigests}}'
```

Set `MYPI_SANDBOX_IMAGE` to the resulting `registry/name@sha256:...`. Broker rejects tags and never pulls an image during a user operation. On the execution host install rootless Docker, a functioning cgroup v2 driver, seccomp, and the configured `runsc` runtime. The startup check inspects all these conditions and the pinned image before accepting public execution. Runtime presence is a prerequisite, not a substitute for adversarial acceptance tests.

The broker uses a separate disposable container for every ordinary operation and background lease. It passes only a bounded file snapshot through standard input, with **no host mounts, no ports, no credentials, no control socket and no network**. Each container has a read-only root, non-root UID, all capabilities removed, no-new-privileges, 1 CPU, 1 GiB memory/no extra swap, 128 PIDs, a 256 MiB workspace tmpfs, 32 MiB temporary tmpfs and file-size limits. At most two containers execute together. The persisted snapshot is additionally limited to 64 MiB, 10,000 files and 2 MiB per file. Killing/removing a container ends all descendants, including detached processes. A background lease ends after at most 600 seconds. Workspaces synchronize back only on successful protocol completion; concurrent updates conflict instead of overwriting the main workspace.

Managed file contents, task baselines and background copies share a per-principal 256 MiB persistence budget; writes are serialized for quota checks. Limits are 50 conversation workspaces, 100 child copies and 50 retained background records per principal. A startup and one-minute maintenance pass removes managed conversation files and copies after 24 hours; explicit conversation deletion first terminates jobs, then removes their files. These policies never delete an original trusted-local CLI project. The storage filesystem still needs a deployment-level total capacity alert and quota; application per-principal limits do not claim an unlimited number of anonymous identities is safe.

Start with a random Broker token of at least 32 characters and a private Unix socket. `mypi-broker.service` is an example rootless user service. A loopback-only TCP listener exists for development. Gateway and Worker receive the narrow Broker token but never the Docker socket. Requests cannot select image, mounts, runtime, Docker options or host paths. Startup removes stale containers carrying the server-owned label even when execution has been disabled since the last run; unavailable cleanup is logged and cannot enable execution. Do not run multiple brokers against the same Docker daemon.

## Release gate

Before setting `PUBLIC_EXECUTION_ENABLED=true`, run the dedicated-host security acceptance suite and record actual evidence for SEC-01–SEC-12 in `docs/evidence`. Prove file/credential isolation, denied egress and metadata, CPU/memory/PID/disk limits, container descendants cleanup, cancellations, blocked principals, ownership, budgets and safe artifacts. This repository does not claim those infrastructure tests passed on a machine where the required runtime is unavailable. Keep the switch off until they pass.

There are two gates: the Broker environment switch authorizes isolated execution infrastructure; the administrator's versioned `publicExecutionEnabled` policy permits new application Runs. Both must be enabled, and Worker checks the current policy on each model/tool call. Turning either one on does not bypass the other. Anonymous identity bootstrap, conversation creation and safe template text viewing remain available while execution is off.

## Optional project imports

`MYPI_ENABLE_IMPORTS=false` is the default in Gateway and Worker. Keep this optional feature disabled on a public deployment until its release environment has passed the isolation/security gate above. A local fixture test enabling imports is not permission to enable public execution. Importing only stores a content snapshot; it never runs Git, package installation, archive scripts, repository configuration, a shell, or the model. Import works without a configured model or enabled execution.

When explicitly enabled, the ZIP upload is at most 10 MiB compressed, 32 MiB expanded, 2,000 entries, 2 MiB per file, and a 100:1 expansion ratio. Both extraction and download have a 30-second deadline. Paths, Unicode/case aliases, links, devices, unknown archive metadata, encrypted entries, and checksums are validated before storage. Git metadata, `.pi`, `.mypi`, `.agents`, `.codex`, `.claude`, `node_modules`, build-output directories `dist`/`.next`, and MCP executable configuration are omitted. Imported workspaces contain files only and do not include Git history. The UI shows the omission list and requires the current workspace revision before replacing contents; modified or busy workspaces reject stale imports. Binary files remain bytes and show a binary preview indicator; the text export path refuses binary and truncated files.

Public GitHub import accepts only `https://github.com/owner/repo` (optional `.git`), verifies the repository's public metadata, and downloads a ZIP from fixed `api.github.com` / `codeload.github.com` endpoints. Every redirect and DNS answer must pass the same checks; the TLS request pins the validated public IP and sends no cookies, token, proxy configuration or model credentials. Only the Worker needs outbound HTTPS to these two hosts. Never permit container egress to support imports. Private repositories and other Git providers are unsupported.

Nginx allows 15 MiB request bodies for base64 transport; Gateway retains a 32 KiB ordinary-route limit and a 15 MiB import-route limit. Private Worker RPC likewise permits 15 MiB only for import and otherwise 128 KiB. Broker permits 48 MiB only for the validated snapshot-import method and otherwise 3 MiB. The narrow import method still enforces ownership, revision, managed main workspace, file count, byte limits, metadata filtering and the principal's aggregate disk budget. See `docs/evidence/import-verification.md` for actual fixture checks and external-environment tests that were not run.

Back up SQLite using its consistent backup API, plus private file snapshots and encrypted model configuration. Stop new Runs, cancel in-flight jobs, stop the Broker, then upgrade. Restore backups in a separate private directory and validate ownership and quota data before replacing production state.

## Retention and backup commands

Worker maintenance runs at startup and once a minute. After 24 hours a guest identity cannot authorize a new call even before the sweep runs. Cleanup first prevents new calls and settles active sessions, then deletes Broker files, selected SDK private histories, user messages, Runs, tasks, workflows, patches, result inbox entries, artifacts and replay events. Cleanup failures remain `deleting` and retry. Metering rows retain only cost/token/version identifiers for 30 days; deletion/security audits remain append-only metadata. Archiving a conversation stops its jobs and retains files; deleting removes them.

```sh
node --import tsx scripts/backup.ts \
  --source /var/lib/mypi/private/mypi.sqlite \
  --out /var/backups/mypi/2026-09-23
```

The destination must be new. This uses Node's SQLite online backup API, verifies integrity/foreign keys, writes a SHA-256 checksum and an artifact manifest read from the backed-up snapshot. Current exported artifact contents are stored inline in SQLite and are included. An online database backup does not snapshot Broker workspace directories or SDK session files: pause writes and copy those private directories for a complete deployment restore. Preserve the separate master encryption key in your secret store; the backup contains encrypted model credentials, not that key. Periodically restore the database in an isolated private directory and verify the manifest before replacing live data. See [Node.js SQLite backup](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsourceDb-path-options).

References: [Docker run constraints](https://docs.docker.com/engine/containers/run/), [rootless resource limits](https://docs.docker.com/engine/security/rootless/tips/), [Docker security](https://docs.docker.com/engine/security/).
