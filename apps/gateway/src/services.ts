import type { ModelConfig } from '@mypi/contracts';

/** HTTP adaptation boundary: the Gateway never loads or executes the SDK. */
export interface GatewayServices {
  createConversation?(
    ownerId: string,
    input: { title?: string; mode: 'native' | 'explicit'; templateId: string },
    idempotencyKey: string,
  ): Promise<any>;
  submit(
    ownerId: string,
    conversationId: string,
    input: { text: string; mode: 'native' | 'explicit'; modelId?: string },
    idempotencyKey: string,
  ): Promise<any>;
  cancel(ownerId: string, runId: string): Promise<any>;
  cancelTask?(ownerId: string, taskId: string): Promise<any>;
  importProject?(
    ownerId: string,
    conversationId: string,
    input:
      | { kind: 'zip'; archiveBase64: string; expectedRevision: string }
      | { kind: 'github'; url: string; ref?: string; expectedRevision: string },
    key: string,
  ): Promise<any>;
  workspace?(ownerId: string, conversationId: string): Promise<any>;
  file?(ownerId: string, conversationId: string, path: string): Promise<any>;
  artifact?(
    ownerId: string,
    artifactId: string,
  ): Promise<{ name: string; content: Buffer | string; mime?: string }>;
  testModel?(model: ModelConfig): Promise<{
    ok: boolean;
    latencyMs: number;
    usageKnown: boolean;
    errorCode: string | null;
    usage?: unknown;
  }>;
  ruleTest?(input: {
    text: string;
    mode: 'native' | 'explicit';
    simulatedSource?: string;
  }): Promise<any>;
  ready?(): Promise<{ ready: boolean; sandboxEnforced?: boolean; [key: string]: unknown }>;
  deleteConversation?(ownerId: string, conversationId: string): Promise<void>;
  archiveConversation?(ownerId: string, conversationId: string): Promise<void>;
  subscribeEvents?(callback: (event: any) => void): () => void;
  processes?(ownerId: string, conversationId: string): Promise<any>;
  stopProcess?(ownerId: string, conversationId: string, processId: string): Promise<any>;
  applyPatch?(
    ownerId: string,
    conversationId: string,
    taskId: string,
    baseRevision: string,
  ): Promise<any>;
  exportFile?(ownerId: string, conversationId: string, path: string): Promise<any>;
}
