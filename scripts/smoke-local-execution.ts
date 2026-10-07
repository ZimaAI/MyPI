/** Run inside the local Broker container. Uses no model and deletes its own workspace. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BrokerSandboxClient } from '../packages/sandbox-client/src/client.ts';

assert.equal(process.env.MYPI_LOCAL_DOCKER_ENABLED, 'true');
const client = new BrokerSandboxClient({
  baseUrl: 'http://127.0.0.1:4102',
  token: process.env.MYPI_BROKER_TOKEN!,
});
const health = await client.health();
assert.equal(health.ready, true);
assert.equal(health.profile, 'isolated-local');
assert.equal(health.publicExecutionEnabled, false);
const owner = { principalId: `smoke-${randomUUID()}`, conversationId: `smoke-${randomUUID()}` };
const workspace = await client.createWorkspace({ ...owner, templateId: 'empty' });
const otherOwner = { ...owner, conversationId: `${owner.conversationId}-second` };
const otherWorkspace = await client.createWorkspace({ ...otherOwner, templateId: 'empty' });
const request = { ...owner, workspaceId: workspace.workspaceId, runId: 'local-smoke' };
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
let controller: AbortController | undefined;
try {
  const probe = `
    const fs = require("node:fs"); const assert = require("node:assert/strict");
    assert.equal(process.getuid(),10001);
    assert.equal(fs.existsSync("/data/server/mypi.sqlite"),false);
    assert.equal(fs.existsSync("/var/run/docker.sock"),false);
    assert.equal(process.env.MYPI_MASTER_KEY,undefined);
    assert.equal(process.env.MYPI_BROKER_TOKEN,undefined);
    assert.throws(()=>fs.writeFileSync("/opt/mypi/host-probe","x"));
    assert.equal(fs.readFileSync("/sys/fs/cgroup/memory.max","utf8").trim(),"1073741824");
    assert.equal(fs.readFileSync("/sys/fs/cgroup/pids.max","utf8").trim(),"128");
    const cpu=fs.readFileSync("/sys/fs/cgroup/cpu.max","utf8").trim().split(" ").map(Number);
    assert.equal(cpu[0]/cpu[1],1);
    const status=fs.readFileSync("/proc/self/status","utf8");
    assert.match(status,/NoNewPrivs:\\s+1/); assert.match(status,/Seccomp:\\s+2/);
    assert.match(status,/CapEff:\\s+0+/);
    (async()=>{for(const ip of ["1.1.1.1","169.254.169.254"]){
      await assert.rejects(fetch("http://"+ip,{signal:AbortSignal.timeout(1500)}));
    }console.log("isolation-and-resource-probes-passed")})().catch(()=>process.exit(1));
  `;
  const result = await client.execute({
    ...request,
    operation: 'bash',
    args: { command: `node -e ${shellQuote(probe)}` },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((result.data as any).exitCode, 0, JSON.stringify(result));
  assert.match((result.data as any).stdout, /isolation-and-resource-probes-passed/);
  assert.equal(
    (
      await client.execute({
        ...request,
        operation: 'write',
        args: { path: 'probe.txt', content: 'persisted through isolated container' },
      })
    ).ok,
    true,
  );
  assert.match(
    (await client.workspaceRead({ ...request, path: 'probe.txt' })).content,
    /persisted through isolated container/,
  );
  controller = new AbortController();
  const pending = client
    .execute(
      { ...request, operation: 'bash', args: { command: 'sleep 60 & wait' } },
      controller.signal,
    )
    .catch(() => null);
  const containers = () =>
    execFileSync('docker', ['ps', '-q', '--filter', 'label=mypi.sandbox=true'], {
      encoding: 'utf8',
    }).trim();
  for (let i = 0; i < 50 && !containers(); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(containers(), 'long-running container must actually start');
  const inspected = JSON.parse(
    execFileSync('docker', ['inspect', containers().split('\n')[0]], { encoding: 'utf8' }),
  )[0];
  assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspected.HostConfig.NetworkMode, 'none');
  assert.equal(inspected.HostConfig.MemorySwap, 1073741824);
  assert.equal(inspected.HostConfig.Privileged, false);
  assert.equal(inspected.Mounts.length, 0);
  const second = await client.execute({
    ...request,
    ...otherOwner,
    workspaceId: otherWorkspace.workspaceId,
    operation: 'read',
    args: { path: 'probe.txt' },
  });
  assert.equal(second.error?.code, 'LIMIT_EXCEEDED');
  controller.abort();
  await pending;
  for (let i = 0; i < 100 && containers(); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(containers(), '', 'cancel must remove the container and its descendants');
  console.log(
    JSON.stringify({
      passed: true,
      health,
      checks: [
        'non-root',
        'no host state or secrets',
        'read-only root',
        'cgroup limits',
        'seccomp',
        'no capabilities',
        'no outbound/metadata network',
        'snapshot persistence',
        'single execution slot',
        'cancel cleanup',
      ],
    }),
  );
} finally {
  controller?.abort();
  await client.deleteConversation(otherOwner);
  await client.deleteConversation(owner);
}
