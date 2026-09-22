/** MyPI-owned design contracts. Not Pi SDK exports. No secrets or raw provider payloads. */
export type Mode = 'native' | 'explicit';
export type CapabilityGroup = 'search'|'delegate'|'workflow'|'background'|'session';
export type RunStatus = 'accepted'|'queued'|'running'|'waiting_children'|'succeeded'|'cancelling'|'cancelled'|'failed'|'timed_out'|'budget_exceeded'|'interrupted';
export type TaskStatus = 'queued'|'running'|'succeeded'|'failed'|'timed_out'|'cancelled'|'interrupted';
export interface Usage { inputTokens: number|null; outputTokens: number|null; cachedInputTokens: number|null; status:'known'|'estimated'|'unknown'; costMicros:number|null; currency:string|null; priceVersion:string|null }
export interface ToolSurface { mode:Mode; baseCount:number; extensionCount:number; activeNames:string[]; groups:CapabilityGroup[]; ruleVersion:string; reason:string }
export interface TaskSnapshot { id:string; originRunId:string; title:string; role:'explorer'|'reviewer'|'implementer'; status:TaskStatus; attempt:number; resultId:string|null }
export interface EventPayloads {
  'run.accepted': {status:'accepted';effectiveMode:Mode};
  'run.queued': {position:number};
  'run.started': {generation:number};
  'run.state.changed': {status:RunStatus};
  'run.completed': {status:Extract<RunStatus,'succeeded'|'failed'|'cancelled'|'timed_out'|'budget_exceeded'|'interrupted'>;usage:Usage};
  'message.delta': {messageId:string;delta:string;offset:number};
  'message.completed': {messageId:string;text:string;role:'assistant'|'system_notice'};
  'tool.surface.changed': ToolSurface;
  'tool.started': {toolCallId:string;toolName:string;argumentsPreview:string};
  'tool.output': {toolCallId:string;text:string;stream:'stdout'|'stderr'|'result';truncated:boolean};
  'tool.completed': {toolCallId:string;ok:boolean;durationMs:number;artifactId?:string;errorCode?:string};
  'task.created': TaskSnapshot;
  'task.state.changed': TaskSnapshot;
  'task.result.ready': {taskId:string;resultId:string;originRunId:string;summary:string;artifactIds:string[]};
  'workflow.updated': {workflowId:string;nodes:{id:string;status:TaskStatus|'skipped'}[]};
  'process.updated': {processId:string;status:'running'|'exited'|'cancelling'|'cancelled';exitCode:number|null};
  'artifact.created': {artifactId:string;name:string;size:number;mime:string};
  'quota.updated': {remainingRootRuns:number;remainingTokens:number;reservedTokens:number};
  'policy.revoked': {version:number;reason:string;scope:'principal'|'run'|'global'};
  'error': {code:string;message:string;retryable:boolean};
  'stream.reset': {reason:'expired_cursor'|'snapshot_required';latestSequence:number};
}
export type AgentEvent = { [K in keyof EventPayloads]: {
  schemaVersion:1;eventId:string;sequence:number;type:K;
  conversationId:string;runId:string|null;taskId?:string;
  occurredAt:string;payload:EventPayloads[K];
} }[keyof EventPayloads];
export interface HumanInput { text:string; mode:Mode; modelId?:string; idempotencyKey:string }
export interface RunGrant { group:CapabilityGroup; originInputId:string; originRunId:string; ruleVersion:string; policyVersion:number; generation:number; expiresAt:string; evidence:{start:number;end:number;text:string}[] }
export interface ChildResult { resultId:string;taskId:string;attempt:number;originRunId:string;recipientSessionId:string;status:TaskStatus;summary:string;artifactIds:string[];usage:Usage }
export interface SandboxExecRequest { leaseId:string;workspaceId:string;generation:number;command:string;cwd:string;deadline:string;outputLimitBytes:number }
export interface PiRuntimePort {
  prompt(runId:string, text:string):Promise<void>;
  setActiveTools(names:readonly string[]):Promise<void>;
  awaitSettled():Promise<void>;
  abort():Promise<void>;
  close():Promise<void>;
}
// Adapter must verify real SDK timing; these method names are MyPI abstractions.
