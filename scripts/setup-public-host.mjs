import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const home = homedir();
const configDir = join(home, '.config', 'mypi-public');
const stateDir = join(home, '.local', 'share', 'mypi-public');
const unitDir = join(home, '.config', 'systemd', 'user');
const envPath = join(configDir, 'env');
const unitPath = join(unitDir, 'mypi-public.service');
const token = () => randomBytes(32).toString('base64url');

for (const dir of [configDir, stateDir, unitDir]) mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(configDir, 0o700);
chmodSync(stateDir, 0o700);
if (!existsSync(envPath)) {
  const env = [
    'MYPI_PROFILE=public-demo',
    'MYPI_ORIGIN=https://mypi.zimagent.top',
    'MYPI_HOST=127.0.0.1',
    'MYPI_PORT=13080',
    `MYPI_DATA_DIR=${join(stateDir, 'server')}`,
    `MYPI_BROKER_STATE=${join(stateDir, 'broker')}`,
    'MYPI_WORKER_URL=http://127.0.0.1:14101',
    'MYPI_WORKER_PORT=14101',
    'MYPI_BROKER_URL=http://127.0.0.1:14102',
    'MYPI_BROKER_PORT=14102',
    'PUBLIC_EXECUTION_ENABLED=false',
    'MYPI_ENABLE_IMPORTS=false',
    `MYPI_MASTER_KEY=${randomBytes(32).toString('base64')}`,
    `MYPI_COOKIE_SECRET=${token()}`,
    `MYPI_WORKER_TOKEN=${token()}`,
    `MYPI_BROKER_TOKEN=${token()}`,
    '',
  ].join('\n');
  writeFileSync(envPath, env, { mode: 0o600, flag: 'wx' });
} else chmodSync(envPath, 0o600);

const service = `[Unit]
Description=MyPI public demo (execution disabled)
After=network.target

[Service]
Type=simple
WorkingDirectory=${repo}
Environment=NODE_ENV=production
EnvironmentFile=${envPath}
ExecStart=${process.execPath} scripts/dev.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=40
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
if (existsSync(unitPath)) {
  if (readFileSync(unitPath, 'utf8') !== service)
    throw new Error(`Refusing to replace an existing user service: ${unitPath}`);
} else writeFileSync(unitPath, service, { mode: 0o644, flag: 'wx' });
console.log(`Preserved or generated private configuration: ${envPath}`);
console.log(`Wrote user service: ${unitPath}`);
