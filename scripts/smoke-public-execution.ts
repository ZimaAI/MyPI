/** Run inside the dedicated public Broker container before enabling application Runs. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BrokerSandboxClient } from '../packages/sandbox-client/src/client.ts';

assert.equal(process.env.PUBLIC_EXECUTION_ENABLED, 'true');
assert.equal(process.env.MYPI_PUBLIC_LOW_RESOURCE, 'true');
const info = JSON.parse(
  execFileSync('docker', ['info', '--format', '{{json .}}'], { encoding: 'utf8' }),
);
assert.equal(info.OSType, 'linux');
assert.equal(String(info.CgroupVersion), '2');
assert.equal(info.CgroupDriver, 'systemd');
assert.ok(info.SecurityOptions.some((item: string) => item.includes('rootless')));
assert.ok(info.SecurityOptions.some((item: string) => item.includes('seccomp')));
assert.ok(info.Runtimes.runsc);
const client = new BrokerSandboxClient({
  baseUrl: 'http://127.0.0.1:4102',
  token: process.env.MYPI_BROKER_TOKEN!,
});
const health = await client.health();
assert.equal(health.ready, true);
assert.equal(health.profile, 'isolated');
assert.equal(health.publicExecutionEnabled, true);
const owner = { principalId: `smoke-${randomUUID()}`, conversationId: `smoke-${randomUUID()}` };
const workspace = await client.createWorkspace({ ...owner, templateId: 'empty' });
const otherOwner = { ...owner, conversationId: `${owner.conversationId}-second` };
const otherWorkspace = await client.createWorkspace({ ...otherOwner, templateId: 'empty' });
const request = { ...owner, workspaceId: workspace.workspaceId, runId: 'public-smoke' };
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const containers = () =>
  execFileSync('docker', ['ps', '-q', '--filter', 'label=mypi.sandbox=true'], {
    encoding: 'utf8',
  }).trim();
let controller: AbortController | undefined;
try {
  const probe = `
    const fs = require('node:fs'); const assert = require('node:assert/strict');
    assert.equal(process.getuid(),10001);
    assert.equal(fs.existsSync('/data/server/mypi.sqlite'),false);
    assert.equal(fs.existsSync('/var/run/docker.sock'),false);
    assert.equal(process.env.MYPI_MASTER_KEY,undefined);
    assert.equal(process.env.MYPI_BROKER_TOKEN,undefined);
    assert.throws(()=>fs.writeFileSync('/opt/mypi/host-probe','x'));
    assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'536870912');
    assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'64');
    const cpu=fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(' ').map(Number);
    assert.equal(cpu[0]/cpu[1],0.5);
    const status=fs.readFileSync('/proc/self/status','utf8');
    assert.match(status,/NoNewPrivs:\\s+1/); assert.match(status,/Seccomp:\\s+2/);
    assert.match(status,/CapEff:\\s+0+/);
    (async()=>{for(const ip of ['1.1.1.1','169.254.169.254']){
      await assert.rejects(fetch('http://'+ip,{signal:AbortSignal.timeout(1500)}));
    }console.log('public-isolation-and-resource-probes-passed')})().catch(()=>process.exit(1));
  `;
  const result = await client.execute({
    ...request,
    operation: 'bash',
    args: { command: `node -e ${quote(probe)}` },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((result.data as any).exitCode, 0, JSON.stringify(result));
  assert.match((result.data as any).stdout, /public-isolation-and-resource-probes-passed/);
  assert.equal(
    (
      await client.execute({
        ...request,
        operation: 'write',
        args: { path: 'probe.txt', content: 'isolated public snapshot' },
      })
    ).ok,
    true,
  );
  assert.match((await client.workspaceRead({ ...request, path: 'probe.txt' })).content, /isolated/);
  await assert.rejects(
    client.workspaceRead({ ...request, principalId: 'other-principal', path: 'probe.txt' }),
  );
  controller = new AbortController();
  const pending = client
    .execute(
      { ...request, operation: 'bash', args: { command: 'sleep 60 & wait' } },
      controller.signal,
    )
    .catch(() => null);
  for (let i = 0; i < 50 && !containers(); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(containers(), 'long-running container must actually start');
  const inspected = JSON.parse(
    execFileSync('docker', ['inspect', containers().split('\n')[0]], { encoding: 'utf8' }),
  )[0];
  assert.equal(inspected.HostConfig.Runtime, 'runsc');
  assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspected.HostConfig.NetworkMode, 'none');
  assert.equal(inspected.HostConfig.Memory, 536870912);
  assert.equal(inspected.HostConfig.MemorySwap, 536870912);
  assert.equal(inspected.HostConfig.PidsLimit, 64);
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
  assert.equal(containers(), '', 'cancel must remove the container and descendants');
  console.log(
    JSON.stringify({
      passed: true,
      health,
      checks: [
        'rootless Docker with runsc and systemd cgroup v2',
        'non-root sandbox without host state or credentials',
        'read-only root and no host mounts',
        '0.5 CPU / 512 MiB / 64 PID limits',
        'seccomp and no capabilities',
        'no outbound or metadata network',
        'snapshot persistence and ownership',
        'one execution slot and cancel cleanup',
      ],
    }),
  );
} finally {
  controller?.abort();
  await client.deleteConversation(otherOwner);
  await client.deleteConversation(owner);
}
