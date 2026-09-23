#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve the loader from this installation, not the user's current workspace.
const child = spawn(
  process.execPath,
  [
    '--import',
    import.meta.resolve('tsx'),
    fileURLToPath(new URL('../src/main.ts', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', windowsHide: true },
);

// An interactive terminal sends Ctrl+C to both processes. The child owns the
// first-cancel/second-exit behavior; forwarding it again would double-cancel.
const interrupt = () => {
  if (!process.stdin.isTTY) child.kill('SIGINT');
};
const terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
child.once('error', (error) => {
  process.stderr.write(`MyPI: ${error.message}\n`);
  process.exitCode = 4;
});
child.once('close', (code, signal) => {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 4);
});
