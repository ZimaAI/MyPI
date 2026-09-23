export type SandboxOperation =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'search_files'
  | 'search_content'
  | 'git_show'
  | 'git_diff'
  | 'git_log';
export interface ToolResult<T = unknown> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
  truncated: boolean;
  durationMs: number;
}
export interface Owner {
  principalId: string;
  conversationId: string;
}
export interface Workspace extends Owner {
  workspaceId: string;
  templateId: string;
  revision: string;
  readOnly: boolean;
  parentWorkspaceId?: string;
  baseRevision?: string;
}
export interface ExecuteRequest extends Owner {
  workspaceId: string;
  runId: string;
  operation: SandboxOperation;
  args: Record<string, unknown>;
  readOnly?: boolean;
}
export interface WorkspaceRequest extends Owner {
  workspaceId: string;
}
export interface BackgroundRequest extends WorkspaceRequest {
  runId: string;
  title: string;
  command: string;
  cwd?: string;
  ttlSeconds?: number;
}
export interface ProcessRequest extends Owner {
  processId: string;
}
export interface BackgroundProcess extends Owner {
  processId: string;
  workspaceId: string;
  runId: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'conflict';
  startedAt: string;
  expiresAt: string;
  exitCode?: number;
  logs: { stream: 'stdout' | 'stderr'; text: string; at: string }[];
  truncated: boolean;
}
export interface WorkspaceDiff {
  workspaceId: string;
  parentWorkspaceId: string;
  baseRevision: string;
  currentRevision: string;
  patch: string;
  files: { path: string; status: 'added' | 'modified' | 'deleted' }[];
  conflict: boolean;
}
export interface SandboxHealth {
  ready: boolean;
  profile: 'trusted-local' | 'isolated';
  publicExecutionEnabled: boolean;
  reason?: string;
}
export interface WorkspaceFile {
  path: string;
  bytes: number;
}
export interface WorkspaceFileContent {
  path: string;
  content: string;
  version: string;
  truncated: boolean;
  binary?: boolean;
}
export interface SandboxPort {
  createWorkspace(request: Owner & { templateId?: string }): Promise<Workspace>;
  execute(request: ExecuteRequest, signal?: AbortSignal): Promise<ToolResult>;
  workspaceFiles(request: WorkspaceRequest): Promise<WorkspaceFile[]>;
  workspaceRead(request: WorkspaceRequest & { path: string }): Promise<WorkspaceFileContent>;
  importWorkspace(
    request: WorkspaceRequest & { files: Record<string, string>; expectedRevision?: string },
  ): Promise<Workspace>;
  forkWorkspace(
    request: WorkspaceRequest & { writeMode?: 'read-only' | 'isolated'; readOnly?: boolean },
  ): Promise<Workspace>;
  diffWorkspace(request: WorkspaceRequest): Promise<WorkspaceDiff>;
  applyWorkspace(request: WorkspaceRequest & { baseRevision: string }): Promise<Workspace>;
  backgroundStart(request: BackgroundRequest): Promise<BackgroundProcess>;
  backgroundStatus(request: ProcessRequest & { tailLines?: number }): Promise<BackgroundProcess>;
  backgroundList(
    request: Owner & { status?: BackgroundProcess['status'] },
  ): Promise<BackgroundProcess[]>;
  backgroundWatch(
    request: ProcessRequest & { event?: 'exit' | 'pattern'; pattern?: string; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<BackgroundProcess>;
  backgroundStop(request: ProcessRequest): Promise<BackgroundProcess>;
  releaseConversation(request: Owner): Promise<void>;
  deleteConversation(request: Owner): Promise<void>;
  sweepExpired(ttlHours?: number): Promise<{ deletedConversations: number }>;
  health(): Promise<SandboxHealth>;
}
export class SandboxError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}
