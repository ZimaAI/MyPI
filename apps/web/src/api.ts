import type { ActiveRules } from '../../../packages/policy/src/index.ts';
const csrf: Record<'guest' | 'admin', string> = { guest: '', admin: '' };
export function setCsrf(scope: 'guest' | 'admin', token: string) {
  csrf[scope] = token;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; admin?: boolean; idempotencyKey?: string } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET'
        ? {
            'X-CSRF-Token': csrf[options.admin ? 'admin' : 'guest'],
            'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID(),
          }
        : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const data = await response
    .json()
    .catch(() => ({ code: 'NETWORK_ERROR', message: '服务返回了无效响应' }));
  if (!response.ok)
    throw new ApiError(
      data.code ?? 'REQUEST_FAILED',
      data.message ?? '请求失败',
      response.status,
      data.requestId,
    );
  return data as T;
}
export async function bootstrap() {
  const session = await api<{ csrfToken: string }>('/api/v1/guest-sessions', {
    method: 'POST',
    body: {},
  });
  setCsrf('guest', session.csrfToken);
  return api<Me>('/api/v1/me');
}
export interface Me {
  principalId: string;
  kind: string;
  expiresAt: string;
  publicExecutionEnabled: boolean;
  importsEnabled: boolean;
  intentRules?: ActiveRules;
  profile: string;
  quota: {
    dailyRootRuns: number;
    usedRootRuns: number;
    dailyTokens: number;
    usedTokens: number;
    reservedTokens: number;
    resetAt: string;
  };
  allowedModels: { id: string; displayName: string; defaultForGuests: boolean }[];
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '暂时无法完成，请稍后重试';
