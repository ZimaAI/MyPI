import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SqliteStore, StoreError } from './index.js';
const derive = promisify(scrypt);
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12)
    throw new StoreError(
      'INVALID_INPUT',
      'Administrator password must contain at least 12 characters',
      400,
    );
  const salt = randomBytes(16).toString('hex'),
    key = (await derive(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, hash] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const actual = (await derive(password, salt, 64)) as Buffer,
    expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function createAdmin(
  store: SqliteStore,
  username: string,
  password: string,
): Promise<string> {
  if (!/^[a-zA-Z0-9_.@-]{1,100}$/.test(username))
    throw new StoreError('INVALID_INPUT', 'Invalid administrator username', 400);
  if (store.list('principal').some((row) => row.data.username === username))
    throw new StoreError('VERSION_CONFLICT', 'Administrator already exists');
  const id = randomUUID();
  store.put('principal', id, {
    id,
    kind: 'admin',
    username,
    displayId: username,
    status: 'active',
    passwordHash: await hashPassword(password),
    lastSeenAt: new Date().toISOString(),
  });
  store.audit(id, 'admin.created', id, { username });
  return id;
}
