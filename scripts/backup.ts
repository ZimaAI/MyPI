import { backup, DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function backupDatabase(
  sourcePath: string,
  outputDirectory: string,
): Promise<{ directory: string; pages: number; sha256: string }> {
  const source = await realpath(sourcePath);
  const output = resolve(outputDirectory);
  if (!(await stat(source)).isFile())
    throw new Error('Source must be an existing SQLite database file');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  // A fresh directory is required so an existing backup can never be overwritten.
  await mkdir(output, { mode: 0o700 });
  const database = new DatabaseSync(source, { readOnly: true });
  const destination = join(output, 'mypi.sqlite');
  let pages: number;
  try {
    database.exec('PRAGMA busy_timeout=5000');
    pages = await backup(database, destination);
  } finally {
    database.close();
  }
  await chmod(destination, 0o600);
  const restored = new DatabaseSync(destination, { readOnly: true });
  let artifacts: unknown[];
  let schemaVersion: number;
  try {
    const integrity = restored.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string;
    };
    if (
      integrity.integrity_check !== 'ok' ||
      restored.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('Backup integrity verification failed');
    schemaVersion = Number(
      (
        restored.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as {
          version: number;
        }
      ).version,
    );
    artifacts = restored
      .prepare(
        "SELECT id,owner_id,conversation_id,data_json FROM entity WHERE kind='artifact' ORDER BY id",
      )
      .all()
      .map((row) => {
        const data = JSON.parse(String(row.data_json));
        const content = typeof data.content === 'string' ? data.content : '';
        return {
          id: row.id,
          ownerId: row.owner_id,
          conversationId: row.conversation_id,
          sha256: data.sha256 ?? createHash('sha256').update(content).digest('hex'),
          bytes: Buffer.byteLength(content),
          storage: 'inline-in-sqlite',
        };
      });
  } finally {
    restored.close();
  }
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(destination)) checksum.update(chunk);
  const sha256 = checksum.digest('hex');
  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        schemaVersion,
        database: { file: 'mypi.sqlite', pages, bytes: (await stat(destination)).size, sha256 },
        artifacts,
        scope:
          'SQLite consistent snapshot including inline artifact contents and encrypted model credentials',
        excluded: [
          'Broker workspace snapshots',
          'SDK private session files',
          'master encryption key',
        ],
        restoreNote:
          'For a full deployment backup, pause writes and copy Broker/SDK private directories separately. Keep the master key outside this backup.',
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  return { directory: output, pages, sha256 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source'),
    outIndex = args.indexOf('--out');
  if (
    sourceIndex < 0 ||
    outIndex < 0 ||
    !args[sourceIndex + 1] ||
    !args[outIndex + 1] ||
    args.length !== 4
  )
    throw new Error(
      'Usage: node --import tsx scripts/backup.ts --source /private/mypi.sqlite --out /backups/new-backup-directory',
    );
  console.log(JSON.stringify(await backupDatabase(args[sourceIndex + 1]!, args[outIndex + 1]!)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Backup failed');
    process.exitCode = 1;
  });
