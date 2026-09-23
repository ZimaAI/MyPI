import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  GitBranch,
  History,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api } from './api';
import { Modal } from './ui';

const groups = {
  search: '搜索',
  delegate: '子代理',
  workflow: '工作流',
  background: '后台进程',
  session: '任务管理',
};
type Group = keyof typeof groups;
type RuleConfig = { groups: Record<Group, { enabled: boolean; phrases: string[] }> };
interface Validation {
  ok: boolean;
  total: number;
  failed: number;
  failures: { id: string; expectedGroups: Group[]; actualGroups: Group[] }[];
  validatedAt: string;
  engineVersion: string;
  configDigest: string;
}
interface Draft {
  id: string;
  version: number;
  label: string;
  config: RuleConfig;
  validation?: Validation;
  publishedVersionId?: string;
}
interface Version {
  id: string;
  version: number;
  label: string;
  config: RuleConfig;
  revision: number;
  validation: Validation;
  createdAt: string;
}
interface Rules {
  ruleVersion: string;
  activeVersionId: string;
  config: RuleConfig;
  drafts: Draft[];
  versions: Version[];
}
const request = <T = any,>(path: string, options: Record<string, unknown> = {}) =>
  api<T>(`/api/v1/admin/rules${path}`, { ...options, admin: true });
const textError = (error: unknown) =>
  error instanceof Error ? error.message : '规则操作失败，请重试。';
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export default function RuleVersions() {
  const [rules, setRules] = useState<Rules | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<{ draft?: Draft } | null>(null),
    [confirmation, setConfirmation] = useState<
      { kind: 'publish'; draft: Draft } | { kind: 'rollback'; version: Version } | null
    >(null);
  const load = async () => {
    setLoading(true);
    try {
      setRules(await request<Rules>(''));
    } catch (error) {
      setError(textError(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const selected = rules?.drafts.find((draft) => draft.id === selectedId) ?? rules?.drafts.at(-1);
  async function validate(draft: Draft) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<Validation & { draft: Draft }>(`/drafts/${draft.id}/validate`, {
        method: 'POST',
        body: { expectedVersion: draft.version },
      });
      setSelectedId(draft.id);
      await load();
      setNotice(
        result.ok
          ? `黄金集校验通过：${result.total} 个用例全部符合预期。`
          : `校验未通过：${result.failed} / ${result.total} 个用例需要处理。`,
      );
    } catch (error) {
      setError(textError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="adm-card adm-rule-versions">
      <div className="adm-section-heading">
        <div>
          <h2>规则版本与发布</h2>
          <p>编辑有限动作词表，通过黄金集回归后发布。只影响之后的用户请求。</p>
        </div>
        <GitBranch size={21} />
      </div>
      <div className="adm-rules-toolbar">
        <div>
          <span className="adm-tag good">
            <span />
            {rules?.activeVersionId === 'explicit-v1'
              ? '内置规则生效'
              : rules
                ? `已发布规则生效`
                : '正在读取版本'}
          </span>
          {rules && (
            <code title={rules.activeVersionId}>
              {rules.activeVersionId.length > 24
                ? `${rules.activeVersionId.slice(0, 22)}…`
                : rules.activeVersionId}
            </code>
          )}
        </div>
        <div className="adm-actions">
          <button
            className="adm-button"
            aria-label="刷新规则版本"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
            刷新
          </button>
          <button className="adm-button primary" disabled={!rules} onClick={() => setEditor({})}>
            <Plus size={16} />
            新建规则草稿
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="adm-notice danger">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="adm-notice">
          {notice}
        </div>
      )}
      {!rules ? (
        <p className="adm-muted" role="status">
          {loading ? '正在读取规则版本…' : '规则暂不可用。'}
        </p>
      ) : (
        <>
          <div className="adm-rules-columns">
            <div className="adm-rules-drafts">
              <h3>草稿</h3>
              {rules.drafts.length ? (
                rules.drafts.map((draft) => (
                  <button
                    key={draft.id}
                    className={`adm-rule-draft ${selected?.id === draft.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(draft.id)}
                  >
                    <span>
                      <strong>{draft.label}</strong>
                      <small>草稿 v{draft.version}</small>
                    </span>
                    <span
                      className={`adm-tag ${draft.validation?.ok ? 'good' : draft.validation ? 'bad' : 'neutral'}`}
                    >
                      <span />
                      {draft.publishedVersionId
                        ? '已发布'
                        : draft.validation?.ok
                          ? '可发布'
                          : draft.validation
                            ? '校验失败'
                            : '未校验'}
                    </span>
                  </button>
                ))
              ) : (
                <div className="adm-rule-empty">
                  <FileCheck2 size={24} />
                  <strong>还没有规则草稿</strong>
                  <p>从当前生效版本建立草稿，内置安全判断会继续生效。</p>
                </div>
              )}
            </div>
            <div className="adm-rule-review">
              {selected ? (
                <>
                  <div className="adm-rule-review-heading">
                    <div>
                      <h3>{selected.label}</h3>
                      <p>
                        草稿 v{selected.version} · 已配置{' '}
                        {Object.values(selected.config.groups).reduce(
                          (count, group) => count + group.phrases.length,
                          0,
                        )}{' '}
                        条额外短语
                      </p>
                    </div>
                    <button className="adm-button" onClick={() => setEditor({ draft: selected })}>
                      编辑草稿
                    </button>
                  </div>
                  <div className="adm-rule-group-summary">
                    {(Object.entries(groups) as [Group, string][]).map(([key, label]) => (
                      <div key={key}>
                        <span>{label}</span>
                        <span
                          className={selected.config.groups[key].enabled ? 'enabled' : 'disabled'}
                        >
                          {selected.config.groups[key].enabled ? '允许匹配' : '停止匹配'}
                        </span>
                        <small>{selected.config.groups[key].phrases.length} 条扩展短语</small>
                      </div>
                    ))}
                  </div>
                  {selected.validation ? (
                    <div
                      className={`adm-validation-report ${selected.validation.ok ? 'passed' : 'failed'}`}
                    >
                      <div>
                        <CheckCircle2 size={19} />
                        <strong>
                          {selected.validation.ok ? '黄金集回归通过' : '黄金集回归失败'}
                        </strong>
                      </div>
                      <p>
                        {selected.validation.total - selected.validation.failed} /{' '}
                        {selected.validation.total} 个用例通过 ·{' '}
                        {timestamp(selected.validation.validatedAt)}
                      </p>
                      <small>
                        校验引擎 {selected.validation.engineVersion} · 配置{' '}
                        {selected.validation.configDigest.slice(0, 12)}
                      </small>
                      {selected.validation.failures.length > 0 && (
                        <details>
                          <summary>查看失败用例（{selected.validation.failures.length}）</summary>
                          <ul>
                            {selected.validation.failures.map((failure) => (
                              <li key={failure.id}>
                                <code>{failure.id}</code>
                                <span>
                                  期望：{failure.expectedGroups.join(', ') || '无扩展'}；实际：
                                  {failure.actualGroups.join(', ') || '无扩展'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  ) : (
                    <div className="adm-validation-empty">
                      <ShieldCheck size={18} />
                      <p>
                        尚未校验。保存后运行黄金集，确认否定、条件、引用及非用户来源不会错误授权。
                      </p>
                    </div>
                  )}
                  <div className="adm-actions">
                    <button
                      className="adm-button"
                      disabled={busy}
                      onClick={() => void validate(selected)}
                    >
                      <FileCheck2 size={16} />
                      {busy ? '正在校验…' : '运行黄金集校验'}
                    </button>
                    <button
                      className="adm-button primary"
                      disabled={busy || !selected.validation?.ok || !!selected.publishedVersionId}
                      title={
                        !selected.validation?.ok
                          ? '草稿必须先通过黄金集校验'
                          : selected.publishedVersionId
                            ? '编辑草稿后可再次发布'
                            : undefined
                      }
                      onClick={() => setConfirmation({ kind: 'publish', draft: selected })}
                    >
                      {selected.publishedVersionId ? '此草稿已发布' : '发布此草稿'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="adm-rule-empty">
                  <GitBranch size={26} />
                  <strong>每次发布都有验证依据</strong>
                  <p>草稿与已发布版本分别保存。进行中的请求保留原规则快照。</p>
                </div>
              )}
            </div>
          </div>
          <div className="adm-rule-history">
            <h3>
              <History size={17} />
              已发布版本
            </h3>
            <div className="adm-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>名称</th>
                    <th>校验结果</th>
                    <th>发布时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rules.versions]
                    .sort((a, b) => b.revision - a.revision)
                    .map((version) => (
                      <tr key={version.id}>
                        <td>
                          <strong>
                            {version.revision === 0 ? '内置 v1' : `发布 v${version.revision}`}
                          </strong>
                          {version.id === rules.activeVersionId && (
                            <small className="adm-rule-active">当前生效</small>
                          )}
                        </td>
                        <td>{version.label}</td>
                        <td>
                          {version.validation.total - version.validation.failed} /{' '}
                          {version.validation.total} 通过
                        </td>
                        <td>{timestamp(version.createdAt)}</td>
                        <td>
                          <button
                            className="adm-link"
                            disabled={version.id === rules.activeVersionId}
                            onClick={() => setConfirmation({ kind: 'rollback', version })}
                          >
                            {version.id === rules.activeVersionId ? '正在使用' : '回滚至此版本'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {editor && rules && (
        <RuleEditor
          draft={editor.draft}
          baseConfig={rules.config}
          onClose={() => setEditor(null)}
          onSaved={async (draft) => {
            setSelectedId(draft.id);
            setEditor(null);
            setNotice('规则草稿已保存，请运行黄金集校验。');
            await load();
          }}
        />
      )}
      {confirmation && (
        <RuleConfirmation
          title={confirmation.kind === 'publish' ? '发布规则草稿' : '回滚规则版本'}
          description={
            confirmation.kind === 'publish'
              ? `「${confirmation.draft.label}」已通过黄金集校验。发布后，新请求将使用此配置。`
              : `将把未来请求的规则切换到「${confirmation.version.label}」，历史执行与已发布版本保持原样。`
          }
          confirm={confirmation.kind === 'publish' ? '确认发布' : '确认回滚'}
          onClose={() => setConfirmation(null)}
          onConfirm={async (reason) => {
            if (confirmation.kind === 'publish')
              await request(`/drafts/${confirmation.draft.id}/publish`, {
                method: 'POST',
                body: { expectedVersion: confirmation.draft.version, reason },
              });
            else
              await request('/rollback', {
                method: 'POST',
                body: { versionId: confirmation.version.id, reason },
              });
            setNotice(
              confirmation.kind === 'publish' ? '新规则版本已生效。' : '已切换到选定的历史版本。',
            );
            setConfirmation(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

function RuleEditor({
  draft,
  baseConfig,
  onClose,
  onSaved,
}: {
  draft?: Draft;
  baseConfig: RuleConfig;
  onClose: () => void;
  onSaved: (draft: Draft) => Promise<void>;
}) {
  const [config, setConfig] = useState<RuleConfig>(() =>
      structuredClone(draft?.config ?? baseConfig),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      groupsConfig = Object.fromEntries(
        (Object.keys(groups) as Group[]).map((group) => [
          group,
          {
            enabled: config.groups[group].enabled,
            phrases: String(form.get(group) ?? '')
              .split('\n')
              .map((phrase) => phrase.trim())
              .filter(Boolean),
          },
        ]),
      );
    setBusy(true);
    setError('');
    try {
      const saved = await request<Draft>(draft ? `/drafts/${draft.id}` : '/drafts', {
        method: draft ? 'PATCH' : 'POST',
        body: {
          label: String(form.get('label')),
          config: { groups: groupsConfig },
          reason: String(form.get('reason')),
          ...(draft ? { expectedVersion: draft.version } : {}),
        },
      });
      await onSaved(saved);
    } catch (error) {
      setError(textError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={draft ? '编辑规则草稿' : '新建规则草稿'}
      onClose={onClose}
      footer={
        <>
          <button className="adm-button" onClick={onClose}>
            取消
          </button>
          <button className="adm-button primary" form="adm-rule-editor" disabled={busy}>
            {busy ? '正在保存…' : '保存草稿'}
          </button>
        </>
      }
    >
      <form id="adm-rule-editor" className="adm-form" onSubmit={submit}>
        <label className="adm-field">
          <span>草稿名称</span>
          <input
            name="label"
            required
            minLength={1}
            maxLength={80}
            defaultValue={draft?.label ?? ''}
            placeholder="例如：项目团队常用指令"
            autoFocus
          />
        </label>
        <p className="adm-form-hint">
          每组最多 12 条字面短语，每条 4–80 个字符，以“使用 / 调用 /
          运行”等动作词开头。每行一条，不支持正则或脚本。
        </p>
        <div className="adm-rule-editor-groups">
          {(Object.entries(groups) as [Group, string][]).map(([group, label]) => (
            <details key={group} className="adm-rule-editor-group" open={group === 'search'}>
              <summary>
                <strong>{label}</strong>
                <span>{config.groups[group].enabled ? '允许匹配' : '停止匹配'}</span>
              </summary>
              <label className="adm-check">
                <input
                  type="checkbox"
                  checked={config.groups[group].enabled}
                  onChange={(event) =>
                    setConfig((old) => ({
                      ...old,
                      groups: {
                        ...old.groups,
                        [group]: { ...old.groups[group], enabled: event.target.checked },
                      },
                    }))
                  }
                />
                启用{label}组的识别
              </label>
              <label className="adm-field">
                <span>{label}额外动作短语</span>
                <textarea
                  name={group}
                  defaultValue={config.groups[group].phrases.join('\n')}
                  rows={3}
                  maxLength={971}
                  placeholder={group === 'search' ? '使用代码检索' : ''}
                />
                <small>内置短语保留；关闭组开关会同时停止该组的内置与额外匹配。</small>
              </label>
            </details>
          ))}
        </div>
        <label className="adm-field">
          <span>草稿变更原因</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
            placeholder="此说明会写入审计日志"
          />
        </label>
        {error && (
          <div role="alert" className="adm-notice danger">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}

function RuleConfirmation({
  title,
  description,
  confirm,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirm: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason'));
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason);
    } catch (error) {
      setError(textError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="adm-button" onClick={onClose}>
            返回
          </button>
          <button className="adm-button primary" form="adm-rule-confirm" disabled={busy}>
            {busy ? '正在处理…' : confirm}
          </button>
        </>
      }
    >
      <form id="adm-rule-confirm" className="adm-form" onSubmit={submit}>
        <p>{description}</p>
        <label className="adm-field">
          <span>发布或回滚原因</span>
          <textarea name="reason" required minLength={3} maxLength={500} rows={3} autoFocus />
        </label>
        {error && (
          <div role="alert" className="adm-notice danger">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
