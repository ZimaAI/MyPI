import { spawn } from 'node:child_process';
if (!process.env.MYPI_MASTER_KEY) throw new Error('Run pnpm setup first.');
const children = [];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.connected) child.send('mypi:shutdown');
    else child.kill('SIGTERM');
  }
  const deadline = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 30000);
  deadline.unref();
}
for (const entry of [
  ...(process.env.MYPI_EXTERNAL_BROKER === 'true' ? [] : ['apps/execution-broker/src/main.ts']),
  'apps/worker/src/main.ts',
  'apps/gateway/src/main.ts',
]) {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: process.env,
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
    if (stopping && children.every((item) => item.exitCode !== null || item.signalCode !== null))
      process.disconnect?.();
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('message', (message) => {
  if (message === 'mypi:shutdown') stop();
});
console.log(`MyPI 本地服务：${process.env.MYPI_ORIGIN ?? 'http://localhost:3000'}（Ctrl+C 停止）`);
