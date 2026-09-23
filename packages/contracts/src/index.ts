export type Mode = 'native' | 'explicit';
export type CapabilityGroup = 'search' | 'delegate' | 'workflow' | 'background' | 'session';
export type RunStatus =
  | 'accepted'
  | 'queued'
  | 'running'
  | 'waiting_children'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'budget_exceeded'
  | 'interrupted';
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'interrupted';
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costMicros: number | null;
  currency: string | null;
  priceVersion: string | null;
  status: 'known' | 'estimated' | 'unknown';
}
export const unknownUsage = (): Usage => ({
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  costMicros: null,
  currency: null,
  priceVersion: null,
  status: 'unknown',
});
export interface ToolResult {
  ok: boolean;
  data: unknown;
  error?: { code: string; message: string };
  truncated: boolean;
  durationMs: number;
  artifactId?: string;
}
export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}
export interface ModelConfig {
  id: string;
  displayName: string;
  providerType: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  maxOutputTokens: number;
  contextWindow: number;
  configVersion: number;
  inputPriceMicros?: number;
  outputPriceMicros?: number;
  currency?: string;
  priceVersion?: string;
}
export interface RuntimeMessage {
  role: 'user' | 'assistant';
  text: string;
}
export type RuntimeEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool-start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-end'; toolCallId: string; toolName: string; result: ToolResult }
  | { type: 'provider-tools'; names: string[]; schemaBytes: number };
export interface RuntimeSession {
  prompt(text: string, signal: AbortSignal): Promise<{ text: string; usage: Usage }>;
  close(): Promise<void>;
}
export interface RuntimeCreateInput {
  sessionId: string;
  model: ModelConfig;
  tools: ToolDefinition[];
  history?: RuntimeMessage[];
  onEvent: (event: RuntimeEvent) => void;
  beforeModelCall: (inputUpperBound?: number) => Promise<string>;
  afterModelCall: (reservationId: string, usage: Usage) => Promise<void>;
}
export interface RuntimeFactory {
  create(input: RuntimeCreateInput): Promise<RuntimeSession>;
}
export interface AgentEvent {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  type: string;
  conversationId: string;
  runId: string | null;
  taskId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}
export interface MatchEvidence {
  group: CapabilityGroup;
  start: number;
  end: number;
  text: string;
  ruleId: string;
}
export interface IntentDecision {
  groups: CapabilityGroup[];
  evidence: MatchEvidence[];
  reasons: string[];
  reasonCode: string;
  ruleVersion: string;
}
export interface Policy {
  version: number;
  publicExecution: boolean;
  dailyRootRuns: number;
  dailyTokens: number;
  maxModelCalls: number;
  runTimeoutMs: number;
  maxConcurrentModels: number;
  maxUserConcurrentModels: number;
  maxChildren: number;
  allowedGroups: CapabilityGroup[];
  processTtlSeconds: number;
}
export const defaultPolicy: Policy = {
  version: 1,
  publicExecution: false,
  dailyRootRuns: 20,
  dailyTokens: 50000,
  maxModelCalls: 12,
  runTimeoutMs: 240000,
  maxConcurrentModels: 3,
  maxUserConcurrentModels: 2,
  maxChildren: 2,
  allowedGroups: ['search', 'delegate', 'workflow', 'background', 'session'],
  processTtlSeconds: 600,
};
export interface Conversation {
  id: string;
  ownerId: string;
  workspaceId: string;
  title: string;
  mode: Mode;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  lastSequence?: number;
  defaultModelId?: string;
}
export interface Run {
  id: string;
  ownerId: string;
  conversationId: string;
  workspaceId: string;
  text: string;
  mode: Mode;
  status: RunStatus;
  model: ModelConfig;
  generation: number;
  deadline: string;
  createdAt: string;
  groups: CapabilityGroup[];
  decision: IntentDecision;
  usage: Usage;
  error?: { code: string; message: string };
  budgetRootRunId: string;
  originRunId?: string;
  policyVersion?: number;
  ruleVersion?: string;
  modelConfigVersion?: number;
  policySnapshot?: Policy;
}
export interface Task {
  id: string;
  ownerId: string;
  conversationId: string;
  originRunId: string;
  title: string;
  prompt: string;
  role: 'explorer' | 'reviewer' | 'implementer';
  writeMode: 'read-only' | 'isolated';
  status: TaskStatus;
  attempt: number;
  resultId?: string;
  summary?: string;
  workspaceId?: string;
  createdAt: string;
  allowedTools: string[];
}
export interface EntityStore {
  get<T>(kind: string, id: string): T | undefined;
  list<T>(kind: string, filter?: { ownerId?: string; conversationId?: string }): T[];
  put<T extends { id: string }>(
    kind: string,
    entity: T,
    ownerId?: string,
    conversationId?: string,
  ): T;
  delete(kind: string, id: string): void;
  transaction<T>(fn: () => T): T;
  appendEvent(
    conversationId: string,
    runId: string | null,
    type: string,
    payload: Record<string, unknown>,
  ): AgentEvent;
  events(conversationId: string, after?: number): AgentEvent[];
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export const terminalRun = (status: string) =>
  ['succeeded', 'failed', 'cancelled', 'timed_out', 'budget_exceeded', 'interrupted'].includes(
    status,
  );
