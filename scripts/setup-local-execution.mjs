// Builds immutable local images; preserves credentials, volumes and application policy.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout?.trim();
}
if (!existsSync('.env.docker')) throw new Error('Run node scripts/setup-docker.mjs first');
const info = JSON.parse(run('docker', ['info', '--format', '{{json .}}'], true));
if (info.OSType !== 'linux' || String(info.CgroupVersion) !== '2' || !info.Runtimes?.runc)
  throw new Error('Local execution requires Linux containers, cgroup v2 and runc');
run(process.execPath, [
  resolve('node_modules/typescript/bin/tsc'),
  '-p',
  'deployment/tsconfig.sandbox.json',
]);
run('docker', ['build', '-f', 'deployment/Dockerfile.sandbox', '-t', 'mypi-sandbox:local', '.']);
const image = run(
  'docker',
  ['image', 'inspect', 'mypi-sandbox:local', '--format', '{{.Id}}'],
  true,
);
if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid immutable image ID');
writeFileSync('.env.local-execution', `MYPI_LOCAL_SANDBOX_IMAGE=${image}\n`, { mode: 0o600 });
run('docker', ['compose', 'build', 'app']);
run('docker', [
  'compose',
  '--env-file',
  '.env.docker',
  '--env-file',
  '.env.local-execution',
  '-f',
  'compose.yaml',
  '-f',
  'compose.local-execution.yaml',
  'build',
  'broker',
]);
console.log(
  'Images ready. Start using the local-execution Compose overlay; the public execution gate remains disabled.',
);
