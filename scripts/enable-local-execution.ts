/** Explicit operator action after local container acceptance, never called at service startup. */
import { join } from 'node:path';
import { localDockerEnabled } from '../packages/sandbox-client/src/deployment.ts';
import { BrokerSandboxClient } from '../packages/sandbox-client/src/client.ts';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import {
  ModelRepository,
  SecretBox,
  type StoredModel,
} from '../packages/storage-sqlite/src/security.ts';
import type { Policy } from '../packages/contracts/src/index.ts';

if (!localDockerEnabled(process.env))
  throw new Error('Only the explicit local Docker profile is supported');
const client = new BrokerSandboxClient({
  baseUrl: process.env.MYPI_BROKER_URL!,
  token: process.env.MYPI_BROKER_TOKEN!,
});
const health = await client.health();
if (
  !health.ready ||
  health.profile !== 'isolated-local' ||
  !health.localExecutionEnabled ||
  health.publicExecutionEnabled
)
  throw new Error('Local Docker Broker is not ready');
const store = new SqliteStore(join(process.env.MYPI_DATA_DIR!, 'mypi.sqlite'));
try {
  const models = new ModelRepository(store, new SecretBox(process.env.MYPI_MASTER_KEY!));
  const model = models.resolveModel();
  const row = store.get<StoredModel>('model', model.id)!;
  if (row.data.testedVersion !== row.version)
    throw new Error('Guest default must pass its current connection test');
  const old = store.get<Policy>('policy', 'current');
  if (!old) throw new Error('Application policy is missing');
  if (
    !old.data.publicExecution ||
    old.data.maxConcurrentModels !== 1 ||
    old.data.maxUserConcurrentModels !== 1
  ) {
    const policy = {
      ...old.data,
      version: old.data.version + 1,
      publicExecution: true,
      maxConcurrentModels: 1,
      maxUserConcurrentModels: 1,
    };
    store.transaction(() => {
      store.put('policy', 'current', policy, { expectedVersion: old.version });
      store.put('policy-version', String(policy.version), policy);
      store.audit('local-operator', 'policy.local-execution.enabled', 'current', {
        reason: 'User-authorized single-user loopback Docker deployment',
        previousVersion: old.data.version,
        version: policy.version,
      });
    });
  }
  console.log(
    JSON.stringify({
      enabled: true,
      deployment: 'local-docker',
      modelConcurrency: 1,
      publicInfrastructureEnabled: false,
    }),
  );
} finally {
  store.close();
}
