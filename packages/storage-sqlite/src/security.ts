import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { ModelConfig, Policy } from '@mypi/contracts';
import { defaultPolicy } from '@mypi/contracts';
import { SqliteStore, StoreError } from './index.js';

export { hashPassword, verifyPassword, createAdmin } from './admin.js';
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const csrfToken = (token: string, secret: string) =>
  createHmac('sha256', secret).update(`csrf:${token}`).digest('base64url');
export class SecretBox {
  private key: Buffer;
  constructor(masterKey: string) {
    const key = Buffer.from(masterKey, 'base64');
    if (key.length !== 32)
      throw new Error('MYPI_MASTER_KEY must contain 32 random bytes encoded as base64');
    this.key = key;
  }
  encrypt(value: string): string {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    return [
      'v1',
      iv.toString('base64url'),
      Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }
  decrypt(value: string): string {
    const [version, iv, body, tag] = value.split('.');
    if (version !== 'v1' || !iv || !body || !tag) throw new Error('Unsupported secret envelope');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([cipher.update(Buffer.from(body, 'base64url')), cipher.final()]).toString(
      'utf8',
    );
  }
}
export const approvedEndpoints: Record<string, { providerType: string; baseUrl: string }> = {
  openai: { providerType: 'openai', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { providerType: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  google: { providerType: 'google', baseUrl: 'https://generativelanguage.googleapis.com' },
};
export interface StoredModel {
  id: string;
  displayName: string;
  providerType: string;
  modelId: string;
  approvedEndpointId: string;
  encryptedKey?: string;
  keyFingerprint?: string;
  enabled: boolean;
  publicSelectable: boolean;
  defaultForGuests: boolean;
  maxOutputTokens: number;
  contextWindow: number;
  configVersion: number;
  testedVersion?: number;
  inputPriceMicros?: number;
  outputPriceMicros?: number;
  currency?: string;
}
export class ModelRepository {
  constructor(
    readonly store: SqliteStore,
    readonly secrets: SecretBox,
  ) {}
  resolveModel(id?: string, publicOnly = true): ModelConfig {
    const record = id
      ? this.store.get<StoredModel>('model', id)
      : this.store
          .list<StoredModel>('model')
          .find((row) => row.data.defaultForGuests && row.data.enabled);
    if (!record || (publicOnly && (!record.data.enabled || !record.data.publicSelectable)))
      throw new StoreError('MODEL_UNAVAILABLE', 'No available model is configured', 503);
    const model = record.data,
      endpoint = approvedEndpoints[model.approvedEndpointId];
    if (!endpoint || endpoint.providerType !== model.providerType)
      throw new StoreError('MODEL_UNAVAILABLE', 'The provider endpoint is not approved', 503);
    if (!model.encryptedKey)
      throw new StoreError('MODEL_UNAVAILABLE', 'The model credential is not configured', 503);
    return {
      id: model.id,
      displayName: model.displayName,
      providerType: model.providerType,
      modelId: model.modelId,
      apiKey: this.secrets.decrypt(model.encryptedKey),
      baseUrl: endpoint.baseUrl,
      maxOutputTokens: model.maxOutputTokens,
      contextWindow: model.contextWindow,
      configVersion: record.version,
      inputPriceMicros: model.inputPriceMicros,
      outputPriceMicros: model.outputPriceMicros,
      currency: model.currency,
      priceVersion: `${model.id}:${record.version}`,
    };
  }
  list(publicOnly = false): any[] {
    return this.store
      .list<StoredModel>('model')
      .filter((row) => !publicOnly || (row.data.enabled && row.data.publicSelectable))
      .map((row) => this.publicModel(row));
  }
  publicModel(row: { data: StoredModel; version: number }): any {
    const { encryptedKey, keyFingerprint, ...model } = row.data;
    return {
      ...model,
      version: row.version,
      keyConfigured: !!encryptedKey,
      keyFingerprint: keyFingerprint ? `••••${keyFingerprint}` : null,
    };
  }
}
export function effectivePolicy(store: SqliteStore): Policy {
  return store.get<Policy>('policy', 'current')?.data ?? { ...defaultPolicy };
}
export function scrub<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub) as T;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/apiKey|encryptedKey|password|tokenHash|csrfHash|baseUrl|sdkSessionRef|storageKey/i.test(
            key,
          ),
      )
      .map(([key, val]) => [key, scrub(val)]),
  ) as T;
}
