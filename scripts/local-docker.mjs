import { spawnSync } from 'node:child_process';
const actions = {
  start: ['up', '-d', '--wait'],
  stop: ['stop'],
  status: ['ps'],
  check: ['exec', '-T', 'broker', 'node', '--import', 'tsx', 'scripts/smoke-local-execution.ts'],
  enable: ['exec', '-T', 'app', 'node', '--import', 'tsx', 'scripts/enable-local-execution.ts'],
};
const action = process.argv[2] ?? 'status';
if (!(action in actions)) throw new Error('Use start, stop, status, check or enable');
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env.docker',
    '--env-file',
    '.env.local-execution',
    '-f',
    'compose.yaml',
    '-f',
    'compose.local-execution.yaml',
    ...actions[action],
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
