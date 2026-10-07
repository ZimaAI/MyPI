/** Tighten public quotas while keeping application Runs closed for security acceptance. */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import type { Policy } from '../packages/contracts/src/index.ts';

const stateDir = process.argv[2];
if (!stateDir)
  throw new Error('Usage: node --import tsx scripts/set-low-resource-public-policy.ts STATE_DIR');
const database = join(resolve(stateDir), 'mypi.sqlite');
if (!existsSync(database)) throw new Error(`Existing MyPI database not found: ${database}`);
const store = new SqliteStore(database);
try {
  const old = store.get<Policy>('policy', 'current');
  if (!old) throw new Error('Application policy is missing');
  const policy: Policy = {
    ...old.data,
    version: old.data.version + 1,
    publicExecution: false,
    dailyRootRuns: Math.min(old.data.dailyRootRuns, 3),
    dailyTokens: Math.min(old.data.dailyTokens, 30000),
    maxModelCalls: Math.min(old.data.maxModelCalls, 4),
    runTimeoutMs: Math.min(old.data.runTimeoutMs, 180000),
    maxConcurrentModels: Math.min(old.data.maxConcurrentModels, 1),
    maxUserConcurrentModels: Math.min(old.data.maxUserConcurrentModels, 1),
    maxChildren: Math.min(old.data.maxChildren, 1),
    processTtlSeconds: Math.min(old.data.processTtlSeconds, 120),
  };
  if (old.data.publicExecution)
    throw new Error('Disable application Runs before tightening policy');
  if (
    Object.keys(policy).every(
      (key) => key === 'version' || policy[key as keyof Policy] === old.data[key as keyof Policy],
    )
  ) {
    console.log('Low-resource public policy already applied; execution remains disabled.');
  } else {
    store.transaction(() => {
      store.put('policy', 'current', policy, { expectedVersion: old.version });
      store.put('policy-version', String(policy.version), policy);
      store.applyPolicyQuotaLimits(
        { tokens: policy.dailyTokens, roots: policy.dailyRootRuns, calls: policy.maxModelCalls },
        'system:deployment',
        'Low-resource public deployment',
        policy.version,
      );
      store.audit('system:deployment', 'policy.low-resource.prepared', 'current', {
        previousVersion: old.data.version,
        version: policy.version,
        executionEnabled: false,
      });
    });
    console.log(
      JSON.stringify({
        prepared: true,
        version: policy.version,
        publicExecutionEnabled: false,
        dailyRootRuns: policy.dailyRootRuns,
        dailyTokens: policy.dailyTokens,
        modelConcurrency: policy.maxConcurrentModels,
      }),
    );
  }
} finally {
  store.close();
}
