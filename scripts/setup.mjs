import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('保留已有 .env。');
  process.exit(0);
}
const token = () => randomBytes(32).toString('base64url');
writeFileSync(
  '.env',
  [
    '# Generated private local configuration. Never commit this file.',
    'MYPI_PROFILE=local',
    'MYPI_HOST=127.0.0.1',
    'MYPI_PORT=3000',
    'MYPI_ORIGIN=http://localhost:3000',
    'MYPI_DATA_DIR=.mypi/server',
    'MYPI_BROKER_STATE=.mypi/broker',
    'MYPI_WORKER_URL=http://127.0.0.1:4101',
    'MYPI_WORKER_PORT=4101',
    'MYPI_BROKER_URL=http://127.0.0.1:4102',
    'MYPI_BROKER_PORT=4102',
    `MYPI_MASTER_KEY=${randomBytes(32).toString('base64')}`,
    `MYPI_COOKIE_SECRET=${token()}`,
    `MYPI_WORKER_TOKEN=${token()}`,
    `MYPI_BROKER_TOKEN=${token()}`,
    'PUBLIC_EXECUTION_ENABLED=false',
    'MYPI_ENABLE_IMPORTS=false',
    'MYPI_SANDBOX_RUNTIME=runsc',
    'MYPI_SANDBOX_IMAGE=',
    '',
  ].join('\n'),
  { mode: 0o600, flag: 'wx' },
);
console.log('已生成私有 .env；公开执行保持关闭。运行 pnpm build && pnpm dev。');
