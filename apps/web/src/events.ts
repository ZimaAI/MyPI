import type { AgentEvent } from '../../../packages/contracts/src/index.ts';
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system_notice';
  text: string;
  runId?: string;
  createdAt?: string;
  streaming?: boolean;
}
export interface ViewState {
  sequence: number;
  messages: Message[];
  runs: Record<string, any>;
  tasks: Record<string, any>;
  surface: {
    baseCount: number;
    extensionCount: number;
    activeNames: string[];
    groups: string[];
    reason: string;
    [key: string]: unknown;
  };
  events: AgentEvent[];
  processes: Record<string, any>;
  workItems: any[];
  goals: any[];
  error?: string;
  pending?: Record<number, AgentEvent>;
}
export const emptyView = (): ViewState => ({
  sequence: 0,
  messages: [],
  runs: {},
  tasks: {},
  surface: {
    baseCount: 4,
    extensionCount: 0,
    activeNames: ['read', 'write', 'edit', 'bash'],
    groups: [],
    reason: '等待本轮请求',
  },
  events: [],
  processes: {},
  workItems: [],
  goals: [],
});
const keyBy = (rows: any[], key = 'id') => Object.fromEntries(rows.map((r) => [r[key], r]));
export function hydrate(snapshot: any): ViewState {
  return {
    ...emptyView(),
    sequence: snapshot.lastSequence ?? 0,
    surface: snapshot.toolSurface ?? emptyView().surface,
    messages: snapshot.messages ?? [],
    runs: keyBy(snapshot.runs ?? []),
    tasks: keyBy(snapshot.tasks ?? []),
    processes: keyBy(snapshot.processes ?? [], 'processId'),
    workItems: snapshot.workItems ?? [],
    goals: snapshot.goals ?? [],
  };
}
const terminalStatuses = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'budget_exceeded',
  'interrupted',
]);
/** Apply a contiguous stream. Gaps stay buffered so reconnect/replay cannot discard
 * another entity's lower-sequence event merely because a later one arrived first. */
export function reduceEvent(state: ViewState, event: AgentEvent): ViewState {
  if (event.sequence <= state.sequence || state.pending?.[event.sequence]) return state;
  const pending = { ...state.pending, [event.sequence]: event };
  let next = { ...state, pending };
  while (pending[next.sequence + 1]) {
    const ready = pending[next.sequence + 1];
    delete pending[next.sequence + 1];
    next = applyOrdered(next, ready) as typeof next;
  }
  return next;
}
function applyOrdered(state: ViewState, event: AgentEvent): ViewState {
  const next = { ...state, sequence: event.sequence, events: [...state.events, event].slice(-150) },
    p = event.payload as any;
  if (event.type === 'message.delta' || event.type === 'message.completed') {
    const existing = state.messages.find((m) => m.id === p.messageId);
    if (event.type === 'message.delta' && existing && existing.streaming !== true) return next;
    const text =
      event.type === 'message.completed'
        ? p.text
        : (existing?.text ?? '').slice(0, p.offset) + p.delta;
    const item: Message = {
      ...existing,
      id: p.messageId,
      role: p.role ?? 'assistant',
      text,
      runId: event.runId ?? undefined,
      streaming: event.type === 'message.delta',
    };
    next.messages = existing
      ? state.messages.map((m) => (m.id === item.id ? item : m))
      : [...state.messages, item];
  }
  if (event.type.startsWith('run.') && event.runId) {
    const previous = state.runs[event.runId];
    if (!terminalStatuses.has(previous?.status)) {
      const status =
        event.type === 'run.started'
          ? 'running'
          : event.type === 'run.queued'
            ? 'queued'
            : (p.status ?? 'accepted');
      next.runs = { ...state.runs, [event.runId]: { ...previous, id: event.runId, status, ...p } };
    }
  }
  if (event.type === 'tool.surface.changed') next.surface = p;
  if (event.type === 'task.created' || event.type === 'task.state.changed') {
    const previous = state.tasks[p.id];
    if (!terminalStatuses.has(previous?.status) || (p.attempt ?? 0) > (previous?.attempt ?? 0))
      next.tasks = { ...state.tasks, [p.id]: { ...previous, ...p } };
  }
  if (event.type === 'task.result.ready')
    next.tasks = {
      ...state.tasks,
      [p.taskId]: {
        ...state.tasks[p.taskId],
        summary: p.summary,
        resultId: p.resultId,
        originRunId: p.originRunId,
      },
    };
  if (event.type === 'process.updated') {
    const process = p.process ?? p,
      previous = state.processes[process.processId];
    if (!previous || previous.status === 'running' || process.status !== 'running')
      next.processes = { ...state.processes, [process.processId]: process };
  }
  if (event.type === 'error') next.error = p.message;
  return next;
}
export const eventTypes = [
  'run.accepted',
  'run.queued',
  'run.started',
  'run.state.changed',
  'run.completed',
  'message.delta',
  'message.completed',
  'tool.surface.changed',
  'tool.started',
  'tool.output',
  'tool.completed',
  'provider.tools',
  'task.created',
  'task.state.changed',
  'task.result.ready',
  'workflow.updated',
  'process.updated',
  'artifact.created',
  'quota.updated',
  'policy.revoked',
  'error',
  'stream.reset',
];
