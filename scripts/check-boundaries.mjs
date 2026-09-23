import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
async function files(dir) {
  const all = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test'].includes(item.name)) continue;
    const p = join(dir, item.name);
    if (item.isDirectory()) all.push(...(await files(p)));
    else if (/\.[cm]?[jt]sx?$/.test(p)) all.push(p);
  }
  return all;
}
const violations = [];
for (const path of [...(await files('packages')), ...(await files('apps'))]) {
  const text = await readFile(path, 'utf8');
  const normalized = path.replaceAll('\\', '/');
  for (const match of text.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
    const target = match[2];
    if (
      /@(?:earendil-works|mariozechner)\/pi-/.test(target) &&
      !normalized.startsWith('packages/pi-adapter/')
    )
      violations.push(`${path}: SDK import outside adapter`);
    if (
      normalized.startsWith('packages/agent-core/') &&
      /gateway|react|fastify|storage-sqlite/.test(target)
    )
      violations.push(`${path}: core dependency points outward`);
    if (normalized.startsWith('apps/web/src/') && /pi-adapter|node:|storage-sqlite/.test(target))
      violations.push(`${path}: private server dependency in browser`);
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('Dependency boundaries passed.');
