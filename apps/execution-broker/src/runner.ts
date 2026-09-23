// This program runs only inside the disposable sandbox container. No host mount or secret is supplied.
import {
  operate,
  restore,
  snapshot,
  type Snapshot,
} from '../../../packages/sandbox-client/src/engine.js';
import type { SandboxOperation } from '../../../packages/sandbox-client/src/types.js';

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 96 * 1024 * 1024) throw new Error('SNAPSHOT_LIMIT');
    chunks.push(Buffer.from(chunk));
  }
  const input = JSON.parse(Buffer.concat(chunks).toString()) as {
    files: Snapshot;
    operation: SandboxOperation;
    args: Record<string, unknown>;
  };
  await restore('/workspace', input.files);
  const result = await operate(
    '/workspace',
    input.operation,
    input.args,
    undefined,
    (stream, text) => {
      process.stdout.write(
        JSON.stringify({ type: 'log', stream, text: text.slice(0, 16384) }) + '\n',
      );
    },
  );
  const files = await snapshot('/workspace');
  process.stdout.write(JSON.stringify({ type: 'result', result, files }) + '\n');
}
main().catch(() => {
  process.stderr.write('Sandbox operation failed\n');
  process.exitCode = 1;
});
