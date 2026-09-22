-- MyPI SQLite schema draft. No backend/ORM/migrations are supplied.
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE principal (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('guest','admin')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','banned','deleted')),
 display_id TEXT NOT NULL, password_hash TEXT, created_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE auth_session (
 id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES principal(id),
 token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
 revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE model_config (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, provider_type TEXT NOT NULL,
 provider_model_id TEXT NOT NULL, approved_endpoint_id TEXT NOT NULL,
 encrypted_key BLOB, key_version INTEGER, enabled INTEGER NOT NULL DEFAULT 0,
 public_selectable INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE policy_version (
 version INTEGER PRIMARY KEY, config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 created_by TEXT NOT NULL REFERENCES principal(id), created_at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE workspace (
 id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES principal(id),
 storage_key TEXT NOT NULL UNIQUE, revision TEXT NOT NULL, template_id TEXT NOT NULL,
 status TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(id,principal_id)
);
CREATE TABLE conversation (
 id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES principal(id),
 workspace_id TEXT NOT NULL, title TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('native','explicit')),
 status TEXT NOT NULL DEFAULT 'active', sdk_session_ref TEXT,
 default_model_id TEXT REFERENCES model_config(id),
 last_sequence INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,principal_id),
 FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace(id,principal_id)
);
CREATE TABLE run (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, principal_id TEXT NOT NULL,
 input_id TEXT NOT NULL UNIQUE, source TEXT NOT NULL CHECK(source IN ('human','task_result')),
 original_text TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 mode_snapshot TEXT NOT NULL CHECK(mode_snapshot IN ('native','explicit')),
 rule_version TEXT NOT NULL, policy_version INTEGER NOT NULL REFERENCES policy_version(version),
 model_config_id TEXT REFERENCES model_config(id), model_config_version INTEGER,
 status TEXT NOT NULL CHECK(status IN ('accepted','queued','running','waiting_children','succeeded','cancelling','cancelled','failed','timed_out','budget_exceeded','interrupted')),
 generation INTEGER NOT NULL DEFAULT 0, deadline TEXT NOT NULL,
 created_at TEXT NOT NULL, finished_at TEXT, error_code TEXT,
 budget_root_run_id TEXT NOT NULL, origin_run_id TEXT,
 CHECK((source='human' AND origin_run_id IS NULL) OR (source='task_result' AND origin_run_id IS NOT NULL)),
 UNIQUE(id,principal_id), UNIQUE(principal_id,conversation_id,idempotency_key),
 FOREIGN KEY(conversation_id,principal_id) REFERENCES conversation(id,principal_id),
 FOREIGN KEY(budget_root_run_id,principal_id) REFERENCES run(id,principal_id),
 FOREIGN KEY(origin_run_id,principal_id) REFERENCES run(id,principal_id)
);
CREATE TABLE capability_decision (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES run(id), group_name TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('allowed','denied','released','revoked')),
 reason_code TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 rule_version TEXT NOT NULL, policy_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE agent_task (
 id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, origin_run_id TEXT NOT NULL,
 parent_task_id TEXT, title TEXT NOT NULL, role TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','timed_out','cancelled','interrupted')),
 attempt INTEGER NOT NULL DEFAULT 1, sdk_session_ref TEXT, snapshot_ref TEXT,
 grant_json TEXT NOT NULL CHECK(json_valid(grant_json)), base_revision TEXT,
 cancel_requested INTEGER NOT NULL DEFAULT 0, deadline TEXT NOT NULL,
 created_at TEXT NOT NULL, finished_at TEXT, UNIQUE(id,principal_id),
 FOREIGN KEY(origin_run_id,principal_id) REFERENCES run(id,principal_id),
 FOREIGN KEY(parent_task_id,principal_id) REFERENCES agent_task(id,principal_id)
);
CREATE TABLE task_result (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES agent_task(id),
 attempt INTEGER NOT NULL, summary TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL, UNIQUE(task_id,attempt)
);
CREATE TABLE result_inbox (
 id TEXT PRIMARY KEY, recipient_session_id TEXT NOT NULL,
 origin_run_id TEXT NOT NULL REFERENCES run(id), result_id TEXT NOT NULL REFERENCES task_result(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','delivered','suppressed')),
 claimed_at TEXT, delivered_at TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 UNIQUE(recipient_session_id,result_id)
);
CREATE TABLE quota_bucket (
 id TEXT PRIMARY KEY, scope_type TEXT NOT NULL CHECK(scope_type IN ('principal','global','root_run','admin')),
 scope_id TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 token_limit INTEGER NOT NULL CHECK(token_limit>=0), tokens_used INTEGER NOT NULL DEFAULT 0,
 tokens_reserved INTEGER NOT NULL DEFAULT 0, root_limit INTEGER NOT NULL DEFAULT 0,
 roots_used INTEGER NOT NULL DEFAULT 0, call_limit INTEGER NOT NULL DEFAULT 0, calls_used INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1, UNIQUE(scope_type,scope_id,period_start),
 CHECK(tokens_used>=0 AND tokens_reserved>=0)
);
CREATE TABLE model_call (
 id TEXT PRIMARY KEY, root_run_id TEXT NOT NULL REFERENCES run(id), task_id TEXT REFERENCES agent_task(id),
 execution_run_id TEXT NOT NULL REFERENCES run(id),
 provider_request_id TEXT, attempt INTEGER NOT NULL, model_config_id TEXT REFERENCES model_config(id),
 input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER,
 usage_status TEXT NOT NULL CHECK(usage_status IN ('reserved','known','estimated','unknown')),
 cost_micros INTEGER, currency TEXT, price_version TEXT, status TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE quota_reservation (
 id TEXT PRIMARY KEY, bucket_id TEXT NOT NULL REFERENCES quota_bucket(id),
 model_call_id TEXT NOT NULL REFERENCES model_call(id), reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>=0),
 settled_tokens INTEGER, status TEXT NOT NULL CHECK(status IN ('reserved','settled','unknown','released')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(bucket_id,model_call_id)
);
CREATE TABLE quota_adjustment (
 id TEXT PRIMARY KEY, bucket_id TEXT NOT NULL REFERENCES quota_bucket(id),
 actor_id TEXT NOT NULL REFERENCES principal(id), token_limit_delta INTEGER NOT NULL DEFAULT 0,
 root_limit_delta INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE workflow (
 id TEXT PRIMARY KEY, root_run_id TEXT NOT NULL REFERENCES run(id), title TEXT NOT NULL,
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), status TEXT NOT NULL,
 created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE workflow_node (
 workflow_id TEXT NOT NULL REFERENCES workflow(id), node_id TEXT NOT NULL,
 task_id TEXT REFERENCES agent_task(id), status TEXT NOT NULL, result_ref TEXT,
 PRIMARY KEY(workflow_id,node_id)
);
CREATE TABLE background_process (
 id TEXT PRIMARY KEY, root_run_id TEXT NOT NULL REFERENCES run(id), principal_id TEXT NOT NULL REFERENCES principal(id),
 conversation_id TEXT NOT NULL, sandbox_lease_id TEXT NOT NULL, status TEXT NOT NULL,
 process_ref TEXT NOT NULL, deadline TEXT NOT NULL, exit_code INTEGER, log_ref TEXT,
 created_at TEXT NOT NULL, finished_at TEXT,
 FOREIGN KEY(conversation_id,principal_id) REFERENCES conversation(id,principal_id),
 FOREIGN KEY(root_run_id,principal_id) REFERENCES run(id,principal_id)
);
CREATE TABLE work_item (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id), title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('todo','doing','done','blocked')),
 evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_json)), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE goal (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id), title TEXT NOT NULL,
 criteria_json TEXT NOT NULL CHECK(json_valid(criteria_json)), status TEXT NOT NULL,
 evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_json)), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE artifact (
 id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, root_run_id TEXT NOT NULL,
 name TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), mime TEXT NOT NULL, scan_status TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 FOREIGN KEY(root_run_id,principal_id) REFERENCES run(id,principal_id)
);
CREATE TABLE stream_event (
 conversation_id TEXT NOT NULL REFERENCES conversation(id), sequence INTEGER NOT NULL,
 event_id TEXT NOT NULL UNIQUE, run_id TEXT REFERENCES run(id), type TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(conversation_id,sequence)
);
CREATE TABLE outbox (
 id TEXT PRIMARY KEY, topic TEXT NOT NULL, aggregate_id TEXT NOT NULL,
 dedup_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 available_at TEXT NOT NULL, published_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE audit_event (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES principal(id), action TEXT NOT NULL,
 resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, request_id TEXT NOT NULL,
 summary_json TEXT NOT NULL CHECK(json_valid(summary_json)), result TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_conv_owner ON conversation(principal_id,updated_at);
CREATE INDEX idx_run_conv ON run(conversation_id,created_at);
CREATE INDEX idx_run_status ON run(status,deadline);
CREATE INDEX idx_task_origin ON agent_task(origin_run_id,status);
CREATE INDEX idx_inbox_pending ON result_inbox(recipient_session_id,status);
CREATE INDEX idx_model_root ON model_call(root_run_id,started_at);
CREATE INDEX idx_outbox_pending ON outbox(state,available_at);
CREATE INDEX idx_audit_time ON audit_event(created_at);
CREATE INDEX idx_artifact_expiry ON artifact(expires_at);
