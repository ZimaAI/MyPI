import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
const target = new URL('../.env.docker', import.meta.url);
if (existsSync(target)) {
  console.log('保留已有 .env.docker。');
} else {
  const token = () => randomBytes(32).toString('base64url');
  writeFileSync(
    target,
    [
      '# Private Docker Desktop secrets. Never commit this file.',
      `MYPI_MASTER_KEY=${randomBytes(32).toString('base64')}`,
      `MYPI_COOKIE_SECRET=${token()}`,
      `MYPI_WORKER_TOKEN=${token()}`,
      `MYPI_BROKER_TOKEN=${token()}`,
      '',
    ].join('\n'),
    { mode: 0o600, flag: 'wx' },
  );
  console.log('已生成 .env.docker；运行 docker compose up -d --build。');
}
