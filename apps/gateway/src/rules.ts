import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SqliteStore, StoreError, type Stored } from '@mypi/storage-sqlite';
import {
  defaultRuleConfig,
  GROUPS,
  matchIntent,
  validateRuleConfig,
  type RuleConfig,
} from '@mypi/policy';
import type { CapabilityGroup, Mode } from '@mypi/contracts';
import golden from '../../../fixtures/golden-intents.json' with { type: 'json' };

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const datasetDigest = digest(golden);
interface Failure {
  id: string;
  expectedGroups: CapabilityGroup[];
  actualGroups: CapabilityGroup[];
}
interface Validation {
  ok: boolean;
  total: number;
  failed: number;
  failures: Failure[];
  configDigest: string;
  datasetDigest: string;
  engineVersion: string;
  validatedAt: string;
}
interface Draft {
  label: string;
  config: RuleConfig;
  validation?: Validation;
  publishedVersionId?: string;
}
interface RuleVersion {
  label: string;
  config: RuleConfig;
  revision: number;
  validation: Validation;
  createdBy: string | null;
  createdAt: string;
}
const view = <T extends object>(row: Stored<T>) => ({
  ...row.data,
  id: row.id,
  version: row.version,
});

export function evaluateRuleConfig(input: unknown): Validation {
  const config = validateRuleConfig(input),
    rules = { version: 'candidate', config };
  const samples = golden.cases.map((sample) => ({
    id: sample.id,
    text: sample.text,
    mode: sample.mode as Mode,
    source: sample.source,
    expectedGroups: (sample.expectedGroups as CapabilityGroup[]).filter(
      (group) => config.groups[group].enabled,
    ),
  }));
  // Each new phrase must retain all trust/quotation/negation gates, even when it
  // did not occur in the immutable canonical regression corpus.
  for (const group of Object.keys(config.groups) as CapabilityGroup[])
    for (const [index, phrase] of config.groups[group].phrases.entries()) {
      const expected: CapabilityGroup[] = config.groups[group].enabled ? [group] : [];
      const id = `configured-${group}-${index}`;
      samples.push({
        id,
        text: phrase,
        mode: 'explicit',
        source: 'human',
        expectedGroups: expected,
      });
      for (const text of [
        `不要${phrase}`,
        `如果需要，${phrase}`,
        `解释“${phrase}”`,
        `\`\`\`\n${phrase}\n\`\`\``,
        `> ${phrase}`,
      ])
        samples.push({
          id: id + '-guard-' + samples.length,
          text,
          mode: 'explicit',
          source: 'human',
          expectedGroups: [],
        });
      for (const source of ['tool', 'task_result', 'assistant'])
        samples.push({
          id: id + '-' + source,
          text: phrase,
          mode: 'explicit',
          source,
          expectedGroups: [],
        });
      samples.push({
        id: id + '-native',
        text: phrase,
        mode: 'native',
        source: 'human',
        expectedGroups: [],
      });
    }
  const failures: Failure[] = [];
  for (const sample of samples) {
    const actual = matchIntent(sample.text, sample.mode, sample.source, rules).groups;
    if (JSON.stringify(actual) !== JSON.stringify(sample.expectedGroups))
      failures.push({ id: sample.id, expectedGroups: sample.expectedGroups, actualGroups: actual });
  }
  return {
    ok: failures.length === 0,
    total: samples.length,
    failed: failures.length,
    failures: failures.slice(0, 100),
    configDigest: digest(config),
    datasetDigest,
    engineVersion: 'explicit-v1',
    validatedAt: new Date().toISOString(),
  };
}

export class RuleRepository {
  constructor(readonly store: SqliteStore) {
    store.db
      .exec(`CREATE TRIGGER IF NOT EXISTS rule_version_no_update BEFORE UPDATE ON entity WHEN OLD.kind='ruleVersion' BEGIN SELECT RAISE(ABORT,'immutable rule version'); END;
      CREATE TRIGGER IF NOT EXISTS rule_version_no_delete BEFORE DELETE ON entity WHEN OLD.kind='ruleVersion' BEGIN SELECT RAISE(ABORT,'immutable rule version'); END;`);
    store.transaction(() => {
      if (!store.get('ruleVersion', 'explicit-v1')) {
        const config = defaultRuleConfig();
        store.put<RuleVersion>('ruleVersion', 'explicit-v1', {
          label: '内置规则',
          config,
          revision: 0,
          validation: evaluateRuleConfig(config),
          createdBy: null,
          createdAt: new Date().toISOString(),
        });
      }
      if (!store.get('ruleActive', 'current'))
        store.put('ruleActive', 'current', { versionId: 'explicit-v1' });
    });
  }
  list() {
    const activeVersionId = this.store.get<{ versionId: string }>('ruleActive', 'current')!.data
      .versionId;
    return {
      ruleVersion: activeVersionId,
      activeVersionId,
      groups: GROUPS,
      config: this.store.get<RuleVersion>('ruleVersion', activeVersionId)!.data.config,
      drafts: this.store.list<Draft>('ruleDraft').map(view),
      versions: this.store.list<RuleVersion>('ruleVersion').map(view),
    };
  }
  private draft(id: string, expectedVersion: number) {
    const row = this.store.get<Draft>('ruleDraft', id);
    if (!row) throw new StoreError('RESOURCE_NOT_FOUND', '规则草稿不存在', 404);
    if (row.version !== expectedVersion)
      throw new StoreError('VERSION_CONFLICT', '规则草稿已更新，请重新读取');
    return row;
  }
  create(
    input: { label: string; config: unknown; reason: string },
    actor: string,
    requestId: string,
  ) {
    const config = validateRuleConfig(input.config);
    return this.store.transaction(() => {
      const row = this.store.put<Draft>('ruleDraft', randomUUID(), { label: input.label, config });
      this.store.audit(
        actor,
        'rules.draft.created',
        row.id,
        { reason: input.reason, configDigest: digest(config) },
        requestId,
      );
      return view(row);
    });
  }
  update(
    id: string,
    input: { expectedVersion: number; label?: string; config?: unknown; reason: string },
    actor: string,
    requestId: string,
  ) {
    return this.store.transaction(() => {
      const old = this.draft(id, input.expectedVersion),
        config = input.config === undefined ? old.data.config : validateRuleConfig(input.config);
      const row = this.store.put<Draft>(
        'ruleDraft',
        id,
        { label: input.label ?? old.data.label, config },
        { expectedVersion: old.version },
      );
      this.store.audit(
        actor,
        'rules.draft.updated',
        id,
        { reason: input.reason, configDigest: digest(config) },
        requestId,
      );
      return view(row);
    });
  }
  validate(id: string, expectedVersion: number, actor: string, requestId: string) {
    return this.store.transaction(() => {
      const old = this.draft(id, expectedVersion),
        validation = evaluateRuleConfig(old.data.config);
      const row = this.store.put<Draft>(
        'ruleDraft',
        id,
        { ...old.data, validation },
        { expectedVersion: old.version },
      );
      this.store.audit(
        actor,
        'rules.draft.validated',
        id,
        {
          ok: validation.ok,
          failed: validation.failed,
          total: validation.total,
          configDigest: validation.configDigest,
        },
        requestId,
      );
      return { ...validation, draft: view(row) };
    });
  }
  publish(id: string, expectedVersion: number, reason: string, actor: string, requestId: string) {
    return this.store.transaction(() => {
      const draft = this.draft(id, expectedVersion),
        prior = draft.data.validation,
        validation = evaluateRuleConfig(draft.data.config);
      if (
        !prior?.ok ||
        prior.configDigest !== validation.configDigest ||
        prior.datasetDigest !== datasetDigest ||
        !validation.ok
      )
        throw new StoreError('RULE_VALIDATION_REQUIRED', '当前草稿必须先通过黄金集校验', 400);
      const versionId = `rules-${randomUUID()}`,
        revision =
          Math.max(...this.store.list<RuleVersion>('ruleVersion').map((row) => row.data.revision)) +
          1;
      const row = this.store.put<RuleVersion>('ruleVersion', versionId, {
        label: draft.data.label,
        config: draft.data.config,
        revision,
        validation,
        createdBy: actor,
        createdAt: new Date().toISOString(),
      });
      this.store.put('ruleActive', 'current', { versionId });
      this.store.put<Draft>(
        'ruleDraft',
        id,
        { ...draft.data, publishedVersionId: versionId },
        { expectedVersion: draft.version },
      );
      this.store.audit(
        actor,
        'rules.published',
        versionId,
        { reason, draftId: id, configDigest: validation.configDigest },
        requestId,
      );
      return { activeVersionId: versionId, version: view(row) };
    });
  }
  rollback(versionId: string, reason: string, actor: string, requestId: string) {
    return this.store.transaction(() => {
      const row = this.store.get<RuleVersion>('ruleVersion', versionId);
      if (!row) throw new StoreError('RESOURCE_NOT_FOUND', '已发布规则版本不存在', 404);
      const validation = evaluateRuleConfig(row.data.config);
      if (!validation.ok)
        throw new StoreError('RULE_VALIDATION_REQUIRED', '历史版本未通过当前安全黄金集', 400);
      const from = this.store.get<{ versionId: string }>('ruleActive', 'current')!.data.versionId;
      this.store.put('ruleActive', 'current', { versionId });
      this.store.audit(
        actor,
        'rules.rolled_back',
        versionId,
        { reason, from, configDigest: validation.configDigest },
        requestId,
      );
      return { activeVersionId: versionId, version: view(row) };
    });
  }
}

export function registerRuleRoutes(
  app: FastifyInstance,
  store: SqliteStore,
  actor: (request: FastifyRequest) => string,
) {
  const repository = new RuleRepository(store);
  const text = { type: 'string', minLength: 1, maxLength: 80 },
    reason = { type: 'string', minLength: 3, maxLength: 500 },
    version = { type: 'integer', minimum: 1 };
  const object = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  const params = object({ id: text }, ['id']);
  app.get('/api/v1/admin/rules', async () => repository.list());
  app.post(
    '/api/v1/admin/rules/drafts',
    {
      schema: {
        body: object({ label: text, config: { type: 'object' }, reason }, [
          'label',
          'config',
          'reason',
        ]),
      },
    },
    async (request, reply) =>
      reply.code(201).send(repository.create(request.body as any, actor(request), request.id)),
  );
  app.patch(
    '/api/v1/admin/rules/drafts/:id',
    {
      schema: {
        params,
        body: object(
          { expectedVersion: version, label: text, config: { type: 'object' }, reason },
          ['expectedVersion', 'reason'],
        ),
      },
    },
    async (request) =>
      repository.update(
        (request.params as { id: string }).id,
        request.body as any,
        actor(request),
        request.id,
      ),
  );
  app.post(
    '/api/v1/admin/rules/drafts/:id/validate',
    { schema: { params, body: object({ expectedVersion: version }, ['expectedVersion']) } },
    async (request) =>
      repository.validate(
        (request.params as { id: string }).id,
        (request.body as { expectedVersion: number }).expectedVersion,
        actor(request),
        request.id,
      ),
  );
  app.post(
    '/api/v1/admin/rules/drafts/:id/publish',
    {
      schema: {
        params,
        body: object({ expectedVersion: version, reason }, ['expectedVersion', 'reason']),
      },
    },
    async (request) => {
      const body = request.body as { expectedVersion: number; reason: string };
      return repository.publish(
        (request.params as { id: string }).id,
        body.expectedVersion,
        body.reason,
        actor(request),
        request.id,
      );
    },
  );
  app.post(
    '/api/v1/admin/rules/rollback',
    { schema: { body: object({ versionId: text, reason }, ['versionId', 'reason']) } },
    async (request) => {
      const body = request.body as { versionId: string; reason: string };
      return repository.rollback(body.versionId, body.reason, actor(request), request.id);
    },
  );
}
