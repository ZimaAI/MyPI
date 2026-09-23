import { z } from 'zod';
import type { ToolDefinition, ToolResult } from '../../contracts/src/index.ts';
const s = (max = 1024) => z.string().min(1).max(max),
  id = s(128),
  path = s(512),
  integer = (max: number) => z.number().int().min(1).max(max);
const node = z.strictObject({
  id: s(64),
  type: z.enum(['agent', 'aggregate']),
  title: s(200),
  prompt: s(8192).optional(),
  role: z.enum(['explorer', 'reviewer', 'implementer']).optional(),
  writeMode: z.enum(['read-only', 'isolated']).optional(),
});
export const schemas: Record<string, z.ZodType> = {
  read: z.strictObject({
    path,
    offset: integer(1000000).optional(),
    limit: integer(2000).optional(),
  }),
  write: z.strictObject({ path, content: z.string().max(262144) }),
  edit: z.strictObject({ path, oldText: s(262144), newText: z.string().max(262144) }),
  bash: z.strictObject({ command: s(8192), timeout: integer(60).optional() }),
  mypi_search_files: z.strictObject({
    pattern: s(256),
    root: path.optional(),
    maxResults: integer(100).optional(),
  }),
  mypi_search_content: z.strictObject({
    query: s(512),
    paths: z.array(path).max(20).optional(),
    glob: s(256).optional(),
    regex: z.boolean().optional(),
    maxResults: integer(100).optional(),
  }),
  mypi_git_show: z.strictObject({ ref: s(128), path: path.optional() }),
  mypi_git_diff: z.strictObject({
    base: s(128),
    head: s(128).optional(),
    paths: z.array(path).max(20).optional(),
  }),
  mypi_git_log: z.strictObject({ path: path.optional(), limit: integer(50).optional() }),
  mypi_subagent_spawn: z.strictObject({
    title: s(200),
    prompt: s(8192),
    role: z.enum(['explorer', 'reviewer', 'implementer']),
    writeMode: z.enum(['read-only', 'isolated']),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  }),
  mypi_subagent_check: z.strictObject({ taskId: id }),
  mypi_subagent_list: z.strictObject({ status: s(32).optional(), limit: integer(20).optional() }),
  mypi_subagent_wait: z.strictObject({
    taskIds: z.array(id).min(1).max(4),
    timeoutMs: integer(30000).optional(),
  }),
  mypi_subagent_send: z.strictObject({ taskId: id, message: s(8192) }),
  mypi_subagent_cancel: z.strictObject({ taskId: id }),
  mypi_workflow_run: z.strictObject({
    title: s(200),
    nodes: z.array(node).min(1).max(6),
    edges: z.array(z.strictObject({ from: s(64), to: s(64) })).max(15),
    failurePolicy: z.enum(['stop', 'continue_independent']).optional(),
  }),
  mypi_workflow_status: z.strictObject({ workflowId: id }),
  mypi_workflow_cancel: z.strictObject({ workflowId: id }),
  mypi_bg_start: z.strictObject({
    title: s(200),
    command: s(8192),
    cwd: path.optional(),
    ttlSeconds: integer(600).optional(),
  }),
  mypi_bg_status: z.strictObject({ processId: id, tailLines: integer(100).optional() }),
  mypi_bg_list: z.strictObject({ status: s(32).optional() }),
  mypi_bg_watch: z.strictObject({
    processId: id,
    event: z.enum(['exit', 'pattern']),
    pattern: s(256).optional(),
    timeoutMs: integer(30000).optional(),
  }),
  mypi_bg_stop: z.strictObject({ processId: id }),
  mypi_tasks_add: z.strictObject({
    title: s(200),
    description: s(2048).optional(),
    acceptance: z.array(s(512)).max(10).optional(),
  }),
  mypi_tasks_update: z.strictObject({
    workItemId: id,
    expectedVersion: integer(1000000),
    status: z.enum(['todo', 'doing', 'done', 'blocked']).optional(),
    evidence: z.array(s(1024)).max(20).optional(),
  }),
  mypi_tasks_list: z.strictObject({ status: s(32).optional(), limit: integer(50).optional() }),
  mypi_goal_create: z.strictObject({
    title: s(200),
    successCriteria: z.array(s(512)).min(1).max(10),
  }),
  mypi_goal_get: z.strictObject({ goalId: id.optional() }),
  mypi_goal_update: z.strictObject({
    goalId: id,
    expectedVersion: integer(1000000),
    status: z.enum(['active', 'complete', 'paused', 'blocked']).optional(),
    evidence: z.array(s(1024)).max(20).optional(),
  }),
};
const descriptions: Record<string, string> = {
  read: '读取工作区内的文本文件。',
  write: '原子写入工作区文件。',
  edit: '精确替换唯一匹配的文件文本。',
  bash: '在受控执行器运行有期限命令。',
  mypi_subagent_spawn:
    '创建独立上下文和文件副本的子任务，立即返回 ID；不要循环查询状态，完成结果自动通知。',
  mypi_subagent_wait: '仅在需要同步结果时，基于事件等待有界时间。',
  mypi_subagent_send: '在子任务安全边界追加消息，不会扩大权限。',
  mypi_workflow_run: '启动最多6节点、深度3的JSON DAG。agent独立执行，aggregate确定性汇总。',
  mypi_tasks_update: '更新计划工作项，必须携带版本；done必须提交证据。',
  mypi_goal_update: '更新目标；complete需要执行证据。',
};
export function makeTools(
  names: string[],
  execute: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ToolResult>,
): ToolDefinition[] {
  return names.map((name) => {
    const schema = schemas[name];
    if (!schema) throw new Error(`Unregistered tool: ${name}`);
    return {
      name,
      label: name.replace('mypi_', ''),
      description:
        descriptions[name] ??
        `MyPI ${name.replace('mypi_', '').replaceAll('_', ' ')}。所有ID仅限当前会话，路径必须相对工作区。`,
      parameters: z.toJSONSchema(schema) as Record<string, unknown>,
      execute: async (args, signal) => {
        const start = Date.now();
        try {
          const parsed = schema.parse(args) as Record<string, unknown>;
          return await execute(name, parsed, signal);
        } catch (e) {
          return {
            ok: false,
            data: null,
            error: {
              code:
                e instanceof z.ZodError
                  ? 'INVALID_INPUT'
                  : ((e as { code?: string }).code ?? 'EXECUTION_FAILED'),
              message: e instanceof z.ZodError ? '工具参数不符合契约' : (e as Error).message,
            },
            truncated: false,
            durationMs: Date.now() - start,
          };
        }
      },
    };
  });
}
export interface WorkflowNode {
  id: string;
  type: 'agent' | 'aggregate';
  title: string;
  prompt?: string;
  role?: 'explorer' | 'reviewer' | 'implementer';
  writeMode?: 'read-only' | 'isolated';
}
export interface WorkflowSpec {
  title: string;
  nodes: WorkflowNode[];
  edges: { from: string; to: string }[];
  failurePolicy?: 'stop' | 'continue_independent';
}
export function validateWorkflow(spec: WorkflowSpec): string[][] {
  schemas.mypi_workflow_run.parse(spec);
  const ids = new Set(spec.nodes.map((n) => n.id));
  if (ids.size !== spec.nodes.length) throw new Error('节点 ID 重复');
  for (const e of spec.edges)
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) throw new Error('无效依赖边');
  const levels: string[][] = [],
    seen = new Set<string>();
  while (seen.size < ids.size) {
    const next = [...ids].filter(
      (id) => !seen.has(id) && spec.edges.filter((e) => e.to === id).every((e) => seen.has(e.from)),
    );
    if (!next.length) throw new Error('工作流包含环');
    levels.push(next);
    if (levels.length > 3) throw new Error('工作流深度超过3');
    next.forEach((id) => seen.add(id));
  }
  return levels;
}
