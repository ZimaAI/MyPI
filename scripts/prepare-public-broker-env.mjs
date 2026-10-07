import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const image = process.argv[2];
if (!/^sha256:[a-f0-9]{64}$/.test(image ?? ''))
  throw new Error('Pass the immutable local sandbox image ID, sha256:...');
const configDir = join(homedir(), '.config', 'mypi-public');
const values = Object.fromEntries(
  readFileSync(join(configDir, 'env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const token = values.MYPI_BROKER_TOKEN;
if (!token || token.length < 32) throw new Error('Missing private Broker token');
const target = join(configDir, 'broker.env');
writeFileSync(
  target,
  [
    `MYPI_BROKER_TOKEN=${token}`,
    `MYPI_SANDBOX_IMAGE=${image}`,
    'MYPI_SANDBOX_RUNTIME=runsc',
    '',
  ].join('\n'),
  { mode: 0o600 },
);
chmodSync(target, 0o600);
console.log(`Broker-only environment prepared: ${target}`);
