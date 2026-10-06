import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CirclePause,
  Clock3,
  Download,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, setCsrf } from './api';
import { Modal } from './ui';
import './admin.css';
import RuleVersions from './AdminRules';
import {
  MODEL_CONFIG_LIMITS,
  type ProviderPreset,
  type ModelPreset,
  type ModelProtocol,
  type ModelThinkingLevel,
} from '../../../packages/contracts/src/model-catalog';

type RecordData = Record<string, any>;
type Page = 'overview' | 'models' | 'visitors' | 'policies' | 'executions' | 'audit';
const navigation: { id: Page; title: string; icon: typeof Activity }[] = [
  { id: 'overview', title: '运行概览', icon: LayoutDashboard },
  { id: 'models', title: '模型管理', icon: SlidersHorizontal },
  { id: 'visitors', title: '游客管理', icon: Users },
  { id: 'policies', title: '额度与规则', icon: Settings2 },
  { id: 'executions', title: '运行与子任务', icon: Activity },
  { id: 'audit', title: '审计日志', icon: FileText },
];
const descriptions: Record<Page, string> = {
  overview: '查看真实使用情况，管理模型与执行边界。',
  models: '配置提供商与模型，让每一次调用都有清晰的来源。',
  visitors: '匿名访问，独立身份。查看额度、限制与最近活动。',
  policies: '将额度和工具权限应用到每一棵请求树。',
  executions: '从主请求到子任务，按来源追踪执行与结果。',
  audit: '记录每一次管理变更与敏感访问。',
};
const groupLabels: Record<string, string> = {
  search: '搜索',
  delegate: '子代理',
  workflow: '工作流',
  background: '后台进程',
  session: '任务管理',
};
const statusLabels: Record<string, string> = {
  active: '正常',
  banned: '已封禁',
  deleted: '已删除',
  accepted: '已接收',
  queued: '排队中',
  running: '运行中',
  waiting_children: '等待子任务',
  cancelling: '正在取消',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  timed_out: '已超时',
  budget_exceeded: '额度耗尽',
  success: '成功',
  denied: '拒绝',
  reserved: '已预留',
  settled: '已结算',
  unknown: '用量未知',
};
const date = (value?: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const number = (value: unknown) =>
  typeof value === 'number' ? value.toLocaleString('zh-CN') : '—';
const message = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请重试。');
const request = <T = any,>(path: string, options: RecordData = {}) =>
  api<T>(`/api/v1/admin${path}`, { ...options, admin: true });
function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className={`adm-notice ${danger ? 'danger' : ''}`} role={danger ? 'alert' : 'status'}>
      {danger ? <CirclePause size={17} /> : <ShieldCheck size={17} />}
      <span>{children}</span>
    </div>
  );
}
function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}) {
  return (
    <span className={`adm-tag ${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
function Status({ value }: { value: string }) {
  return (
    <Tag
      tone={
        ['active', 'succeeded', 'success'].includes(value)
          ? 'good'
          : ['banned', 'failed', 'denied', 'budget_exceeded'].includes(value)
            ? 'bad'
            : ['running', 'waiting_children', 'queued', 'unknown'].includes(value)
              ? 'warn'
              : 'neutral'
      }
    >
      {statusLabels[value] ?? value}
    </Tag>
  );
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="adm-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="adm-empty">
      <div className="adm-empty-icon">
        <FileText size={24} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function DownloadJson({ name, data }: { name: string; data: unknown }) {
  return (
    <button
      className="adm-button"
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      <Download size={16} />
      导出 JSON
    </button>
  );
}

export default function Admin({ navigate }: { navigate: (path: string) => void }) {
  const rawPage = location.pathname.split('/')[2],
    page: Page = navigation.some((item) => item.id === rawPage) ? (rawPage as Page) : 'overview';
  const [identity, setIdentity] = useState<RecordData | null>(null),
    [authLoading, setAuthLoading] = useState(true),
    [loginError, setLoginError] = useState('');
  const [data, setData] = useState<RecordData | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [mobile, setMobile] = useState(false);
  const [dialog, setDialog] = useState<{ type: string; item?: RecordData } | null>(null),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('');
  useEffect(() => {
    let active = true;
    request('/me')
      .then((result) => {
        if (active) {
          setCsrf('admin', result.csrfToken);
          setIdentity(result);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!identity) return;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    const endpoint = page === 'policies' ? '/policy' : `/${page}`;
    request(endpoint)
      .then((result) => {
        if (active) setData({ ...result, __page: page });
      })
      .catch((error) => {
        if (active) {
          setError(message(error));
          if (error instanceof ApiError && error.status === 401) setIdentity(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, identity, revision]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const refresh = () => setRevision((value) => value + 1);
  const changePage = (path: string) => {
    setMobile(false);
    setFilter('');
    setDialog(null);
    navigate(path);
  };
  const operation = async (fn: () => Promise<any>, success: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      refresh();
      setNotice(success);
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setLoginError('');
    try {
      const session = await request('/login', {
        method: 'POST',
        body: { username: String(form.get('username')), password: String(form.get('password')) },
      });
      setCsrf('admin', session.csrfToken);
      setIdentity(session);
      navigate('/admin/overview');
    } catch (error) {
      setLoginError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (authLoading)
    return (
      <main className="adm-login">
        <p role="status">正在验证管理员身份…</p>
      </main>
    );
  if (!identity)
    return (
      <main className="adm-login">
        <button className="adm-back" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          返回对话工作台
        </button>
        <div className="adm-login-card">
          <div className="adm-brand">
            <img className="adm-brand-symbol" src="/logo.svg" alt="" width="36" height="36" />
            <strong>MyPI</strong>
            <span className="adm-brand-caption">管理控制台</span>
          </div>
          <div className="adm-login-icon">
            <KeyRound size={25} />
          </div>
          <h1>欢迎回来</h1>
          <p>使用独立管理员身份登录控制台。</p>
          <form onSubmit={login}>
            <Field label="管理员账号">
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={100}
                autoFocus
                placeholder="输入管理员账号"
              />
            </Field>
            <Field label="密码">
              <input
                name="password"
                autoComplete="current-password"
                type="password"
                required
                maxLength={1024}
                placeholder="输入密码"
              />
            </Field>
            {loginError && <Notice danger>{loginError}</Notice>}
            <button className="adm-button primary full" disabled={busy}>
              {busy ? '正在验证…' : '登录控制台'}
              <ArrowRight size={16} />
            </button>
          </form>
          <small className="adm-login-foot">管理员由服务器命令行创建。此处不提供注册。</small>
        </div>
        <p className="adm-login-bottom">MyPI · 独立编码 Agent</p>
      </main>
    );

  const title = navigation.find((item) => item.id === page)!.title;
  return (
    <div className="adm-shell">
      {mobile && (
        <button className="adm-backdrop" aria-label="关闭导航" onClick={() => setMobile(false)} />
      )}
      <aside className={`adm-sidebar ${mobile ? 'open' : ''}`}>
        <button className="adm-brand" onClick={() => changePage('/')} aria-label="返回 MyPI 对话">
          <img className="adm-brand-symbol" src="/logo.svg" alt="" width="36" height="36" />
          <span>
            <strong>MyPI</strong>
            <small>CONTROL CENTER</small>
          </span>
        </button>
        <button className="adm-button adm-return" onClick={() => changePage('/')}>
          <ArrowLeft size={15} />
          返回对话工作台
        </button>
        <div className="adm-nav-label">管理空间</div>
        <nav aria-label="管理导航">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => changePage(`/admin/${item.id}`)}
            >
              <item.icon size={18} />
              {item.title}
              {page === item.id && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>
        <div className="adm-sidebar-bottom">
          <div className="adm-admin-account">
            <span>
              <ShieldCheck size={17} />
            </span>
            <div>
              <strong>{identity.displayId ?? '管理员'}</strong>
              <small>独立管理会话</small>
            </div>
          </div>
          <button
            className="adm-button logout"
            onClick={() =>
              void operation(async () => {
                await request('/logout', { method: 'POST' });
                setIdentity(null);
                setCsrf('admin', '');
                navigate('/admin/login');
              }, '已安全退出')
            }
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>
      <div className="adm-main">
        <header className="adm-topbar">
          <div className="adm-breadcrumb">
            <button className="adm-menu" aria-label="打开管理导航" onClick={() => setMobile(true)}>
              <Menu size={20} />
            </button>
            <span>管理控制台</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <span className="adm-admin-chip">
            <ShieldCheck size={15} />
            管理员
          </span>
        </header>
        <main className="adm-scroll">
          <div className="adm-content">
            <div className="adm-heading">
              <div>
                <div className="adm-eyebrow">WORKSPACE / ADMINISTRATION</div>
                <h1>{title}</h1>
                <p>{descriptions[page]}</p>
              </div>
              <div className="adm-actions">
                <button
                  className="adm-button"
                  onClick={refresh}
                  disabled={loading}
                  aria-label="刷新当前页面"
                >
                  <RefreshCw size={16} className={loading ? 'adm-spinning' : ''} />
                  刷新
                </button>
                {page === 'models' && (
                  <button
                    className="adm-button primary"
                    onClick={() => setDialog({ type: 'model' })}
                  >
                    <Plus size={16} />
                    添加模型
                  </button>
                )}
                {page === 'audit' && data && (
                  <DownloadJson name="mypi-audit.json" data={data.items} />
                )}
              </div>
            </div>
            {error && <Notice danger>{error}</Notice>}
            {notice && <Notice>{notice}</Notice>}
            {loading || (data && data.__page !== page) ? (
              <div className="adm-skeleton" role="status" aria-label="正在加载管理数据">
                <div />
                <div />
                <div />
              </div>
            ) : (
              data && (
                <>
                  {page === 'overview' && (
                    <Overview
                      data={data}
                      navigate={changePage}
                      onStop={() => setDialog({ type: 'stop', item: data })}
                    />
                  )}
                  {page === 'models' && (
                    <>
                      <div className="adm-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>展示名称</th>
                              <th>提供商 / 模型</th>
                              <th>使用状态</th>
                              <th>连接与凭据</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.items.map((model: RecordData) => (
                              <tr key={model.id}>
                                <td>
                                  <strong>{model.displayName}</strong>
                                  <small className="adm-mono">
                                    v{model.version} · {model.id.slice(0, 8)}
                                  </small>
                                </td>
                                <td>
                                  {model.providerType}
                                  <small className="adm-mono">{model.modelId}</small>
                                  <small>
                                    窗口 {number(model.contextWindow)} · 输出预算{' '}
                                    {number(model.maxOutputTokens)}
                                  </small>
                                </td>
                                <td>
                                  <div className="adm-badges">
                                    <Tag tone={model.enabled ? 'good' : 'neutral'}>
                                      {model.enabled ? '已启用' : '已停用'}
                                    </Tag>
                                    {model.defaultForGuests && <Tag tone="good">游客默认</Tag>}
                                  </div>
                                  <small>
                                    {model.publicSelectable ? '前台可选' : '仅管理员可见'}
                                  </small>
                                </td>
                                <td>
                                  <Tag
                                    tone={
                                      model.testedVersion === model.version ? 'good' : 'neutral'
                                    }
                                  >
                                    {model.testedVersion === model.version ? '测试通过' : '待测试'}
                                  </Tag>
                                  <small>
                                    {model.keyConfigured
                                      ? `密钥已配置 ${model.keyFingerprint ?? ''}`
                                      : '密钥未配置'}
                                  </small>
                                </td>
                                <td>
                                  <div className="adm-row-actions">
                                    <button
                                      className="adm-link"
                                      onClick={() => setDialog({ type: 'model', item: model })}
                                    >
                                      编辑
                                    </button>
                                    <button
                                      className="adm-link"
                                      disabled={busy || !model.keyConfigured}
                                      title={!model.keyConfigured ? '请先保存 API Key' : undefined}
                                      onClick={() =>
                                        void operation(async () => {
                                          const result = await request(`/models/${model.id}/test`, {
                                            method: 'POST',
                                          });
                                          if (!result.ok)
                                            throw new Error(
                                              `连接测试失败：${result.errorCode ?? '模型不可用'}`,
                                            );
                                        }, '连接测试通过；测试用量已记录')
                                      }
                                    >
                                      {busy ? '处理中…' : '连接测试'}
                                    </button>
                                    {model.keyConfigured && (
                                      <button
                                        className="adm-link danger"
                                        onClick={() =>
                                          setDialog({ type: 'clear-key', item: model })
                                        }
                                      >
                                        清除密钥
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {data.items.length === 0 && (
                          <Empty
                            title="还没有配置模型"
                            description="添加提供商凭据并完成连接测试，然后设为游客默认。"
                            action={
                              <button
                                className="adm-button primary"
                                onClick={() => setDialog({ type: 'model' })}
                              >
                                <Plus size={16} />
                                添加第一个模型
                              </button>
                            }
                          />
                        )}
                      </div>
                      <div className="adm-guidance">
                        <KeyRound size={20} />
                        <div>
                          <h3>凭据只写入，不回显</h3>
                          <p>
                            密钥由服务器加密保存。编辑时留空会保留原密钥；清除操作需要单独确认。默认模型必须通过连接测试。
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                  {page === 'visitors' && (
                    <>
                      <div className="adm-table-toolbar">
                        <label className="adm-search">
                          <Search size={17} />
                          <input
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                            placeholder="搜索游客编号…"
                            aria-label="搜索游客"
                          />
                        </label>
                        <span>当前加载 {data.items.length} 个游客</span>
                      </div>
                      <div className="adm-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>游客身份</th>
                              <th>请求 / Token 用量</th>
                              <th>状态</th>
                              <th>最近访问</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.items
                              .filter((visitor: RecordData) =>
                                `${visitor.id} ${visitor.displayId}`.includes(filter),
                              )
                              .map((visitor: RecordData) => (
                                <tr key={visitor.id}>
                                  <td>
                                    <strong>{visitor.displayId}</strong>
                                    <small className="adm-mono">{visitor.id.slice(0, 13)}…</small>
                                  </td>
                                  <td>
                                    {number(visitor.usedRootRuns)} 次请求
                                    <small>{number(visitor.usedTokens)} Token · 已结算</small>
                                  </td>
                                  <td>
                                    <Status value={visitor.status} />
                                  </td>
                                  <td>{date(visitor.lastSeenAt)}</td>
                                  <td>
                                    <div className="adm-row-actions">
                                      <button
                                        className="adm-link"
                                        onClick={() =>
                                          setDialog({ type: 'visitor', item: visitor })
                                        }
                                      >
                                        额度与状态
                                      </button>
                                      <button
                                        className={`adm-link ${visitor.status === 'banned' ? '' : 'danger'}`}
                                        onClick={() =>
                                          setDialog({
                                            type: 'visitor',
                                            item: {
                                              ...visitor,
                                              nextStatus:
                                                visitor.status === 'banned' ? 'active' : 'banned',
                                            },
                                          })
                                        }
                                      >
                                        {visitor.status === 'banned' ? '解除封禁' : '封禁'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {!data.items.some((item: RecordData) =>
                          `${item.id} ${item.displayId}`.includes(filter),
                        ) && (
                          <Empty
                            title={filter ? '没有匹配的游客' : '尚无访客'}
                            description={
                              filter
                                ? '尝试其他编号或清除搜索条件。'
                                : '游客首次打开工作台后，会出现在这里。'
                            }
                          />
                        )}
                      </div>
                      <p className="adm-footnote">
                        额度调整只改变可用上限，已消费与预留用量保持记录。
                      </p>
                    </>
                  )}
                  {page === 'policies' && (
                    <>
                      <div className="adm-policy-grid">
                        <PolicyForm
                          key={data.version}
                          policy={data}
                          onSaved={() => {
                            refresh();
                            setNotice('策略已发布，新请求使用新版本。');
                          }}
                        />
                        <RuleWorkbench />
                      </div>
                      <RuleVersions />
                    </>
                  )}
                  {page === 'executions' && (
                    <>
                      <div className="adm-table-toolbar">
                        <div className="adm-small-stat">
                          <Activity size={18} />共 {data.items.length} 个执行记录
                        </div>
                        <button
                          className="adm-button danger"
                          onClick={() =>
                            setDialog({
                              type: 'stop',
                              item: {
                                runningRoots: data.items.filter((item: RecordData) =>
                                  ['accepted', 'queued', 'running', 'waiting_children'].includes(
                                    item.status,
                                  ),
                                ).length,
                              },
                            })
                          }
                        >
                          <CirclePause size={16} />
                          紧急停止
                        </button>
                      </div>
                      <div className="adm-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>执行编号</th>
                              <th>类型</th>
                              <th>所属游客</th>
                              <th>状态</th>
                              <th>创建至今</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.items.map((execution: RecordData) => (
                              <tr key={`${execution.kind}-${execution.id}`}>
                                <td className="adm-mono">{execution.id.slice(0, 16)}…</td>
                                <td>
                                  {{
                                    run: '主请求',
                                    task: '子任务',
                                    process: '后台进程',
                                    sandbox: '沙箱',
                                  }[execution.kind as string] ?? execution.kind}
                                </td>
                                <td>{execution.ownerDisplayId}</td>
                                <td>
                                  <Status value={execution.status} />
                                </td>
                                <td>
                                  {execution.ageSeconds < 60
                                    ? `${execution.ageSeconds} 秒`
                                    : `${Math.floor(execution.ageSeconds / 60)} 分钟`}
                                </td>
                                <td>
                                  {execution.kind === 'run' ? (
                                    <button
                                      className="adm-link"
                                      onClick={() =>
                                        setDialog({ type: 'execution', item: execution })
                                      }
                                    >
                                      查看详情
                                    </button>
                                  ) : (
                                    <span className="adm-muted">关联原始请求</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!data.items.length && (
                          <Empty
                            title="尚无执行记录"
                            description="工作台提交的请求、独立子任务与后台进程将在这里显示。"
                          />
                        )}
                      </div>
                      <p className="adm-footnote">此页按需读取服务端快照。点击刷新获取最新状态。</p>
                    </>
                  )}
                  {page === 'audit' && (
                    <>
                      <div className="adm-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>时间</th>
                              <th>操作者</th>
                              <th>动作</th>
                              <th>对象 / 原因</th>
                              <th>结果</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.items.map((entry: RecordData) => (
                              <tr key={entry.id}>
                                <td>{date(entry.occurredAt)}</td>
                                <td>{entry.actorDisplayId}</td>
                                <td>
                                  <code>{entry.action}</code>
                                </td>
                                <td className="adm-audit-summary">
                                  <span className="adm-mono">{entry.resourceId}</span>
                                  {entry.summary?.reason && <small>{entry.summary.reason}</small>}
                                </td>
                                <td>
                                  <Status value={entry.result} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!data.items.length && (
                          <Empty
                            title="暂无审计记录"
                            description="模型、身份和策略管理操作会自动留下不可修改的记录。"
                          />
                        )}
                      </div>
                      <p className="adm-footnote">
                        当前显示最近 {data.items.length} 条记录。凭据内容不会写入审计摘要。
                      </p>
                    </>
                  )}
                </>
              )
            )}
          </div>
        </main>
      </div>
      {dialog?.type === 'model' && (
        <ModelForm
          model={dialog.item}
          catalog={data?.catalog}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            refresh();
            setNotice('模型配置已保存。');
          }}
        />
      )}
      {dialog?.type === 'visitor' && (
        <VisitorForm
          visitor={dialog.item!}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            refresh();
            setNotice('游客状态与额度已更新。');
          }}
        />
      )}
      {dialog?.type === 'clear-key' && (
        <ReasonDialog
          title="清除模型密钥"
          confirm="确认清除密钥"
          onClose={() => setDialog(null)}
          description={`将删除「${dialog.item!.displayName}」的凭据并停用该模型。此操作不会撤回已经发生的模型费用。`}
          onConfirm={async (reason) => {
            await request(`/models/${dialog.item!.id}/clear-key`, {
              method: 'POST',
              body: { reason, expectedVersion: dialog.item!.version },
            });
            setDialog(null);
            refresh();
            setNotice('模型密钥已清除。');
          }}
        />
      )}
      {dialog?.type === 'stop' && (
        <ReasonDialog
          title="暂停公开执行"
          confirm="暂停并取消运行"
          onClose={() => setDialog(null)}
          description={`将禁止新请求，并请求清理所有在途执行及后台资源。当前快照显示 ${dialog.item?.runningRoots ?? '未知数量的'} 个活动执行。`}
          onConfirm={async (reason) => {
            const result = await request('/emergency-stop', {
              method: 'POST',
              body: { reason, cancelActive: true },
            });
            setDialog(null);
            refresh();
            setNotice(`公开执行已暂停，已发出 ${result.cancellationRequested} 个清理请求。`);
          }}
        />
      )}
      {dialog?.type === 'execution' && (
        <ExecutionDetail id={dialog.item!.id} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function Overview({
  data,
  navigate,
  onStop,
}: {
  data: RecordData;
  navigate: (path: string) => void;
  onStop: () => void;
}) {
  const stats = [
    { label: '活跃游客', value: data.activeVisitors, hint: '当前未封禁的临时身份', icon: Users },
    {
      label: '进行中的请求',
      value: data.runningRoots,
      hint: '尚未进入终态的根请求',
      icon: Activity,
    },
    {
      label: '今日模型调用',
      value: data.modelCallsToday,
      hint: '含子任务与内部汇总',
      icon: BarChart3,
    },
    {
      label: '今日已知 Token',
      value: data.knownTokensToday,
      hint: '依据提供商返回的用量',
      icon: FileText,
    },
  ];
  return (
    <>
      <div className="adm-overview-status">
        <div>
          <ShieldCheck size={20} />
          <span>
            <strong>{data.publicExecutionEnabled ? '公开执行已开启' : '公开执行暂时关闭'}</strong>
            <small>
              {data.publicExecutionEnabled
                ? '新请求仍需通过身份、额度与沙箱校验。'
                : '配置模型与沙箱后，可在策略页面开启。'}
            </small>
          </span>
        </div>
        <Tag tone={data.publicExecutionEnabled ? 'good' : 'warn'}>
          {data.publicExecutionEnabled ? '执行允许' : '已暂停'}
        </Tag>
      </div>
      <div className="adm-stats">
        {stats.map((stat) => (
          <section className="adm-stat" key={stat.label}>
            <div>
              {stat.label}
              <stat.icon size={18} />
            </div>
            <strong>{number(stat.value)}</strong>
            <small>{stat.hint}</small>
          </section>
        ))}
      </div>
      <div className="adm-overview-grid">
        <section className="adm-card">
          <div className="adm-section-heading">
            <div>
              <h2>控制与配置</h2>
              <p>让模型、权限和每次执行保持可追溯。</p>
            </div>
            <Settings2 size={20} />
          </div>
          {[
            {
              title: '模型与凭据',
              description: '连接测试、默认模型与公开可选范围',
              path: 'models',
              icon: SlidersHorizontal,
            },
            {
              title: '额度与工具规则',
              description: '请求预算、并发上限与显式意图试验台',
              path: 'policies',
              icon: Settings2,
            },
            {
              title: '运行与审计',
              description: '查看原始请求、执行结果和管理变更',
              path: 'executions',
              icon: Activity,
            },
          ].map((item) => (
            <button
              className="adm-shortcut"
              key={item.path}
              onClick={() => navigate(`/admin/${item.path}`)}
            >
              <span>
                <item.icon size={19} />
              </span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </div>
              <ArrowRight size={16} />
            </button>
          ))}
        </section>
        <div className="adm-overview-side">
          <section className="adm-card">
            <div className="adm-section-heading">
              <h2>用量可信度</h2>
              <Clock3 size={20} />
            </div>
            <div className="adm-quality-number">
              {number(data.unknownUsageCalls)}
              <span>次用量未知</span>
            </div>
            <p className="adm-muted">未收到完整用量的调用会保留预算预留，不按免费调用处理。</p>
            <div className="adm-update-time">快照时间 · {date(data.asOf)}</div>
          </section>
          <section className="adm-card adm-danger-card">
            <h3>需要暂停执行？</h3>
            <p>紧急停止会关闭新请求，并发出在途资源清理请求。</p>
            <button className="adm-button danger" onClick={onStop}>
              <CirclePause size={16} />
              紧急停止
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

function ModelForm({
  model,
  catalog,
  onClose,
  onSaved,
}: {
  model?: RecordData;
  catalog?: { verifiedAt: string; providers: ProviderPreset[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialProvider =
    catalog?.providers.find((item) => item.id === model?.providerType) ?? catalog?.providers[0];
  const initialPreset = initialProvider?.models.find(
    (item) => item.id === (model?.modelId ?? initialProvider.defaultModelId),
  );
  const [draft, setDraft] = useState({
    providerType: model?.providerType ?? initialProvider?.id ?? '',
    endpointId: model?.approvedEndpointId ?? initialProvider?.defaultEndpointId ?? '',
    modelId: model?.modelId ?? initialPreset?.id ?? '',
    displayName: model?.displayName ?? initialPreset?.name ?? '',
    contextWindow: String(model?.contextWindow ?? initialPreset?.defaultContextWindow ?? 32768),
    maxOutputTokens: String(model?.maxOutputTokens ?? initialPreset?.defaultOutputTokens ?? 4096),
    protocol: (model?.protocol ??
      (model?.providerType === 'openai'
        ? 'openai-completions'
        : initialProvider?.protocol)) as ModelProtocol,
    reasoning: model ? (model.reasoning ?? false) : (initialPreset?.reasoning ?? false),
    thinkingLevel: (model
      ? (model.thinkingLevel ?? 'off')
      : (initialPreset?.thinkingLevel ?? 'off')) as ModelThinkingLevel,
  });
  const [apiKey, setApiKey] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const provider = catalog?.providers.find((item) => item.id === draft.providerType);
  const preset = provider?.models.find((item) => item.id === draft.modelId);
  const endpoint = provider?.endpoints.find((item) => item.id === draft.endpointId);
  const sameModel = model?.providerType === draft.providerType && model?.modelId === draft.modelId;
  const sameEndpoint =
    model?.providerType === draft.providerType && model?.approvedEndpointId === draft.endpointId;
  const change = (key: keyof typeof draft, value: string | boolean) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  function applyPreset(nextProvider: ProviderPreset, next: ModelPreset) {
    setDraft((previous) => ({
      providerType: nextProvider.id,
      endpointId:
        previous.providerType === nextProvider.id
          ? previous.endpointId
          : nextProvider.defaultEndpointId,
      modelId: next.id,
      displayName: next.name,
      contextWindow: String(next.defaultContextWindow),
      maxOutputTokens: String(next.defaultOutputTokens),
      protocol: next.protocol ?? nextProvider.protocol,
      reasoning: next.reasoning,
      thinkingLevel: next.thinkingLevel,
    }));
    setError('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget),
      text = (key: string) => String(values.get(key) ?? '');
    const body: RecordData = {
      displayName: draft.displayName,
      providerType: draft.providerType,
      approvedEndpointId: draft.endpointId,
      modelId: draft.modelId,
      protocol: draft.protocol,
      reasoning: draft.reasoning,
      thinkingLevel: draft.thinkingLevel,
      apiKey,
      enabled: values.has('enabled'),
      publicSelectable: values.has('publicSelectable'),
      maxOutputTokens: Number(values.get('maxOutputTokens')),
      contextWindow: Number(values.get('contextWindow')),
      currency: text('currency'),
      reason: text('reason'),
    };
    if (text('inputPriceMicros') !== '' && text('outputPriceMicros') !== '') {
      body.inputPriceMicros = Number(values.get('inputPriceMicros'));
      body.outputPriceMicros = Number(values.get('outputPriceMicros'));
    }
    if (model) {
      body.expectedVersion = model.version;
      body.defaultForGuests =
        model.testedVersion === model.version
          ? values.has('defaultForGuests')
          : !!model.defaultForGuests;
    }
    setBusy(true);
    setError('');
    try {
      await request(model ? `/models/${model.id}` : '/models', {
        method: model ? 'PATCH' : 'POST',
        body,
      });
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={model ? '编辑模型' : '添加模型'}
      onClose={onClose}
      footer={
        <>
          <button className="adm-button" onClick={onClose}>
            取消
          </button>
          <button className="adm-button primary" form="adm-model-form" disabled={busy || !provider}>
            {busy ? '正在保存…' : '保存模型'}
          </button>
        </>
      }
    >
      <form id="adm-model-form" className="adm-form" onSubmit={submit}>
        {!catalog && <Notice danger>预设目录尚未加载，请关闭弹窗并刷新模型列表后重试。</Notice>}
        <div className="adm-fields">
          <Field label="提供商">
            <select
              value={draft.providerType}
              autoFocus
              onChange={(event) => {
                const next = catalog?.providers.find((item) => item.id === event.target.value);
                if (next) {
                  applyPreset(next, next.models.find((item) => item.id === next.defaultModelId)!);
                  setApiKey('');
                }
              }}
            >
              {(['domestic', 'international'] as const).map((region) => (
                <optgroup key={region} label={region === 'domestic' ? '国内服务商' : '国际服务商'}>
                  {catalog?.providers
                    .filter((item) => item.region === region)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="服务地域">
            <select
              value={draft.endpointId}
              onChange={(event) => {
                change('endpointId', event.target.value);
                setApiKey('');
              }}
            >
              {provider?.endpoints.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="官方模型预设">
          <select
            value={preset?.id ?? ''}
            onChange={(event) => {
              const next = provider?.models.find((item) => item.id === event.target.value);
              if (provider && next) applyPreset(provider, next);
              else {
                change('modelId', '');
                change('displayName', '');
                change('reasoning', false);
                change('thinkingLevel', 'off');
              }
            }}
          >
            {provider?.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.preview ? ' · 预览' : ''}
              </option>
            ))}
            <option value="">手动填写模型 ID</option>
          </select>
        </Field>
        <div className="adm-model-preset">
          <div className="adm-model-limits">
            <span>
              官方上下文{' '}
              <strong>{preset?.contextWindow ? number(preset.contextWindow) : '未知'}</strong>
            </span>
            <span>
              官方输出上限{' '}
              <strong>{preset?.maxOutputTokens ? number(preset.maxOutputTokens) : '未知'}</strong>
            </span>
            {preset?.maxInputTokens && (
              <span>
                官方输入上限 <strong>{number(preset.maxInputTokens)}</strong>
              </span>
            )}
          </div>
          <p>
            {preset?.notes ??
              provider?.notes ??
              '预设覆盖适合文字与工具调用的主要模型，账号可用性以连接测试为准。'}
          </p>
          {preset?.notes && provider?.notes && <p>{provider.notes}</p>}
          <div className="adm-model-source">
            <span>官方文档核对：{catalog?.verifiedAt ?? '未知'}</span>
            <a href={preset?.sources[0] ?? provider?.sources[0]} target="_blank" rel="noreferrer">
              查看官方说明
            </a>
            {preset && provider && (
              <button
                type="button"
                className="adm-link"
                onClick={() => applyPreset(provider, preset)}
              >
                恢复预设参数
              </button>
            )}
          </div>
        </div>
        <Field label="模型端点" hint="地域需与密钥匹配；端点由服务端预设目录提供。">
          <input readOnly value={endpoint?.baseUrl ?? ''} className="adm-mono" />
        </Field>
        <Field label="展示名称">
          <input
            name="displayName"
            required
            maxLength={100}
            value={draft.displayName}
            onChange={(event) => change('displayName', event.target.value)}
          />
        </Field>
        <Field label="模型标识">
          <input
            name="modelId"
            required
            maxLength={200}
            value={draft.modelId}
            onChange={(event) => change('modelId', event.target.value)}
            placeholder="提供商的完整模型 ID"
          />
        </Field>
        <Field
          label="API Key"
          hint={
            model?.keyConfigured && sameEndpoint
              ? '已配置凭据。留空保留现有密钥，输入新值将替换。'
              : '输入此服务商及地域的密钥，仅写入服务器，保存后不会回显。'
          }
        >
          <input
            name="apiKey"
            type="password"
            autoComplete="new-password"
            maxLength={8192}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            required={!!model?.keyConfigured && !sameEndpoint}
            placeholder={model?.keyConfigured && sameEndpoint ? '保留现有密钥' : '输入 API Key'}
          />
        </Field>
        <div className="adm-fields">
          <Field
            label="最大输出 Token"
            hint="MyPI 单次请求预算，可低于官方上限。思考模型通常与思考内容共享此预算。"
          >
            <input
              name="maxOutputTokens"
              type="number"
              required
              min={16}
              max={Math.min(
                preset?.maxOutputTokens ?? MODEL_CONFIG_LIMITS.maxOutputTokens,
                MODEL_CONFIG_LIMITS.maxOutputTokens,
                Number(draft.contextWindow) || MODEL_CONFIG_LIMITS.contextWindow,
              )}
              value={draft.maxOutputTokens}
              onChange={(event) => change('maxOutputTokens', event.target.value)}
            />
          </Field>
          <Field
            label="上下文窗口"
            hint="MyPI 用于上下文管理的 Token 预算。未知规格时请按供应商模型详情调整。"
          >
            <input
              name="contextWindow"
              type="number"
              required
              min={1024}
              max={preset?.contextWindow ?? MODEL_CONFIG_LIMITS.contextWindow}
              value={draft.contextWindow}
              onChange={(event) => change('contextWindow', event.target.value)}
            />
          </Field>
        </div>
        <details className="adm-details">
          <summary>协议与思考设置</summary>
          <Field label="调用协议">
            <select
              value={draft.protocol}
              onChange={(event) => change('protocol', event.target.value)}
            >
              {(draft.providerType === 'openai'
                ? ['openai-responses', 'openai-completions']
                : [provider?.protocol ?? draft.protocol]
              ).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="思考设置">
            <select
              value={draft.thinkingLevel}
              onChange={(event) => {
                change('thinkingLevel', event.target.value);
                if (!preset) change('reasoning', event.target.value !== 'off');
              }}
            >
              {model &&
                sameModel &&
                preset &&
                !preset.thinkingLevels.includes(draft.thinkingLevel) && (
                  <option value={draft.thinkingLevel}>
                    保留原思考设置（{draft.thinkingLevel}）
                  </option>
                )}
              {(preset?.thinkingLevels ?? ['off', 'low', 'medium', 'high']).map((item) => (
                <option key={item} value={item}>
                  {item === 'off'
                    ? '关闭思考'
                    : preset && !preset.thinkingLevels.includes('high')
                      ? '开启思考（模型默认）'
                      : item}
                </option>
              ))}
            </select>
          </Field>
        </details>
        <details className="adm-details" key={`${draft.providerType}:${draft.modelId}`}>
          <summary>计费价格（每百万 Token）</summary>
          <p>
            整数 micro 单位；1,000,000 micro = 1
            个货币单位。价格用于记录真实调用成本；留空表示费用未知。
          </p>
          <div className="adm-fields">
            <Field label="输入价格 · micro">
              <input
                name="inputPriceMicros"
                type="number"
                min={0}
                max={1000000000}
                defaultValue={sameModel ? (model?.inputPriceMicros ?? '') : ''}
              />
            </Field>
            <Field label="输出价格 · micro">
              <input
                name="outputPriceMicros"
                type="number"
                min={0}
                max={1000000000}
                defaultValue={sameModel ? (model?.outputPriceMicros ?? '') : ''}
              />
            </Field>
          </div>
          <Field label="币种">
            <select name="currency" defaultValue={model?.currency ?? 'USD'}>
              <option>USD</option>
              <option>CNY</option>
              <option>EUR</option>
            </select>
          </Field>
        </details>
        <div className="adm-checkboxes">
          <label>
            <input name="enabled" type="checkbox" defaultChecked={model?.enabled ?? false} />
            启用模型
          </label>
          <label>
            <input
              name="publicSelectable"
              type="checkbox"
              defaultChecked={model?.publicSelectable ?? false}
            />
            允许游客选择
          </label>
          <label>
            <input
              name="defaultForGuests"
              type="checkbox"
              defaultChecked={model?.defaultForGuests ?? false}
              disabled={!model || model.testedVersion !== model.version}
            />
            游客默认模型
          </label>
        </div>
        <p className="adm-form-hint">保存后在列表执行连接测试，测试通过后可设为游客默认。</p>
        <Field label="变更原因">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder="说明本次配置或凭据变更的原因"
            rows={2}
          />
        </Field>
        {error && <Notice danger>{error}</Notice>}
      </form>
    </Modal>
  );
}

function VisitorForm({
  visitor,
  onClose,
  onSaved,
}: {
  visitor: RecordData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(visitor.nextStatus ?? visitor.status),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [idempotencyKey] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget),
      body: RecordData = {
        status,
        reason: String(values.get('reason')),
        cancelActive: values.has('cancelActive'),
        expectedVersion: visitor.version,
      };
    for (const key of ['dailyRootRuns', 'dailyTokens'])
      if (values.get(key) !== '') body[key] = Number(values.get(key));
    if (values.get('expiresAt'))
      body.expiresAt = new Date(String(values.get('expiresAt'))).toISOString();
    setBusy(true);
    setError('');
    try {
      await request(`/visitors/${visitor.id}`, { method: 'PATCH', body, idempotencyKey });
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="游客状态与额度"
      onClose={onClose}
      footer={
        <>
          <button className="adm-button" onClick={onClose}>
            取消
          </button>
          <button
            className={`adm-button ${status === 'banned' ? 'danger' : 'primary'}`}
            form="adm-visitor-form"
            disabled={busy}
          >
            {busy ? '正在更新…' : '确认更新'}
          </button>
        </>
      }
    >
      <form id="adm-visitor-form" className="adm-form" onSubmit={submit}>
        <p className="adm-muted">
          {visitor.displayId} · 已使用 {number(visitor.usedRootRuns)} 次请求 /{' '}
          {number(visitor.usedTokens)} Token
        </p>
        <Field label="身份状态">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">正常</option>
            <option value="banned">封禁</option>
          </select>
        </Field>
        {status === 'banned' && (
          <>
            <Field label="封禁结束时间" hint="留空表示持续封禁，直到管理员解除。">
              <input name="expiresAt" type="datetime-local" />
            </Field>
            <label className="adm-check">
              <input type="checkbox" name="cancelActive" defaultChecked />
              同时取消该游客的在途请求与后台资源
            </label>
          </>
        )}
        <div className="adm-fields">
          <Field label="今日请求上限" hint="留空保持当前额度。">
            <input
              name="dailyRootRuns"
              type="number"
              min={0}
              max={1000}
              defaultValue={visitor.dailyRootRuns ?? ''}
            />
          </Field>
          <Field label="今日 Token 上限" hint="已消费与已预留量不会被清除。">
            <input
              name="dailyTokens"
              type="number"
              min={0}
              max={10000000}
              defaultValue={visitor.dailyTokens ?? ''}
            />
          </Field>
        </div>
        <Field label="操作原因">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={3}
            placeholder="请说明封禁、解禁或额度调整原因"
          />
        </Field>
        {error && <Notice danger>{error}</Notice>}
      </form>
    </Modal>
  );
}

function PolicyForm({ policy, onSaved }: { policy: RecordData; onSaved: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget),
      body: RecordData = {
        version: policy.version,
        publicExecutionEnabled: values.has('publicExecutionEnabled'),
        allowedGroups: values.getAll('allowedGroups'),
        reason: String(values.get('reason')),
      };
    for (const key of [
      'dailyRootRuns',
      'dailyTokens',
      'globalModelConcurrency',
      'rootDeadlineSeconds',
      'maxModelCalls',
      'maxUserConcurrentModels',
      'maxChildren',
      'processTtlSeconds',
    ])
      body[key] = Number(values.get(key));
    setBusy(true);
    setError('');
    try {
      await request('/policy', { method: 'PUT', body });
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="adm-card">
      <div className="adm-section-heading">
        <div>
          <h2>执行策略</h2>
          <p>当前生效版本 v{policy.version}</p>
        </div>
        <Settings2 size={20} />
      </div>
      <form className="adm-form" onSubmit={submit}>
        <label className="adm-switch-field">
          <span>
            <strong>允许公开执行</strong>
            <small>开启前需要可用模型与隔离执行器。</small>
          </span>
          <input
            type="checkbox"
            name="publicExecutionEnabled"
            defaultChecked={policy.publicExecutionEnabled}
            aria-label="允许公开执行"
          />
        </label>
        <div className="adm-fields">
          {[
            { key: 'dailyRootRuns', label: '游客每日请求', min: 0, max: 1000 },
            { key: 'dailyTokens', label: '游客每日 Token', min: 0, max: 10000000 },
            { key: 'globalModelConcurrency', label: '全站模型并发', min: 1, max: 16 },
            { key: 'maxUserConcurrentModels', label: '单用户模型并发', min: 1, max: 8 },
            { key: 'maxModelCalls', label: '请求树调用上限', min: 1, max: 100 },
            { key: 'maxChildren', label: '子任务并行上限', min: 0, max: 8 },
            { key: 'rootDeadlineSeconds', label: '请求超时（秒）', min: 10, max: 600 },
            { key: 'processTtlSeconds', label: '后台进程 TTL（秒）', min: 1, max: 600 },
          ].map((field) => (
            <Field label={field.label} key={field.key}>
              <input
                name={field.key}
                type="number"
                required
                min={field.min}
                max={field.max}
                defaultValue={policy[field.key]}
              />
            </Field>
          ))}
        </div>
        <fieldset className="adm-group-field">
          <legend>允许的扩展能力</legend>
          <div className="adm-checkboxes">
            {Object.entries(groupLabels).map(([group, label]) => (
              <label key={group}>
                <input
                  type="checkbox"
                  name="allowedGroups"
                  value={group}
                  defaultChecked={policy.allowedGroups.includes(group)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="adm-form-hint">
          允许能力不等于自动加载。每次请求仍需明确表达并通过服务端规则。发布会同步现有游客的当日额度上限，保留已消费和已预留用量。
        </p>
        <Field label="发布原因">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
            placeholder="说明额度或权限调整原因"
          />
        </Field>
        {error && <Notice danger>{error}</Notice>}
        <button className="adm-button primary" disabled={busy}>
          {busy ? '正在发布…' : '发布新策略'}
          <Check size={16} />
        </button>
      </form>
    </section>
  );
}

function RuleWorkbench() {
  const [text, setText] = useState('使用搜索工具查找鉴权入口'),
    [mode, setMode] = useState('explicit'),
    [source, setSource] = useState('human'),
    [result, setResult] = useState<RecordData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function testRule(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(
        await request('/rules/test', {
          method: 'POST',
          body: { text, mode, simulatedSource: source },
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="adm-card adm-rule-card">
      <div className="adm-section-heading">
        <div>
          <h2>显式意图试验台</h2>
          <p>使用当前服务端规则，测试不会启动 Agent。</p>
        </div>
        <Search size={20} />
      </div>
      <div className="adm-rule-samples">
        {[
          ['明确请求', '使用搜索工具查找鉴权入口'],
          ['否定表达', '不要使用搜索工具，直接解释代码'],
          ['条件表达', '如果测试失败，再使用子代理检查'],
          ['引用文本', '解释“使用工作流检查代码”这句话'],
        ].map(([label, value]) => (
          <button key={label} onClick={() => setText(value)}>
            {label}
          </button>
        ))}
      </div>
      <form className="adm-form" onSubmit={testRule}>
        <Field label="输入文本">
          <textarea
            aria-label="输入文本"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            maxLength={16384}
          />
        </Field>
        <div className="adm-fields">
          <Field label="工具模式">
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="explicit">按需加载</option>
              <option value="native">原生模式</option>
            </select>
          </Field>
          <Field label="模拟来源">
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="human">真实用户</option>
              <option value="tool">工具输出</option>
              <option value="task_result">子任务结果</option>
            </select>
          </Field>
        </div>
        <button className="adm-button primary" disabled={busy}>
          {busy ? '正在匹配…' : '测试规则'}
          <ArrowRight size={16} />
        </button>
      </form>
      {error && <Notice danger>{error}</Notice>}
      <div className="adm-rule-result" role="status">
        {result ? (
          <>
            <div className="adm-rule-result-heading">
              <Tag tone={result.groups.length ? 'good' : 'neutral'}>
                {result.groups.length ? '匹配到明确意图' : '不激活扩展工具'}
              </Tag>
              <small>{result.ruleVersion}</small>
            </div>
            <div className="adm-badges">
              {result.groups.map((group: string) => (
                <Tag key={group} tone="good">
                  {groupLabels[group] ?? group}
                </Tag>
              ))}
            </div>
            <p>{result.reasons.join('；')}</p>
            {result.evidence?.length > 0 && (
              <div className="adm-rule-evidence">
                <small>原始输入中的命中片段</small>
                {result.evidence.map((item: RecordData, index: number) => (
                  <mark key={index}>{item.text}</mark>
                ))}
              </div>
            )}
            <code>{result.reasonCode}</code>
          </>
        ) : (
          <p>点击测试，查看命中依据、拒绝原因与规则版本。</p>
        )}
      </div>
      <div className="adm-rule-footer">
        <ShieldCheck size={17} />
        <span>本页面只能模拟来源。正式运行的来源由服务器签发，工具输出不能授予新权限。</span>
      </div>
    </section>
  );
}

function ReasonDialog({
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
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason'));
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason);
    } catch (error) {
      setError(message(error));
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
          <button className="adm-button danger" form="adm-reason-form" disabled={busy}>
            {busy ? '正在处理…' : confirm}
          </button>
        </>
      }
    >
      <form id="adm-reason-form" className="adm-form" onSubmit={submit}>
        <p>{description}</p>
        <Field label="操作原因">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={3}
            autoFocus
            placeholder="此说明将写入审计日志"
          />
        </Field>
        {error && <Notice danger>{error}</Notice>}
      </form>
    </Modal>
  );
}

function ExecutionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<RecordData | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    request(`/executions/${id}`)
      .then(setData)
      .catch((error) => setError(message(error)));
  }, [id]);
  return (
    <Modal
      title="执行详情"
      onClose={onClose}
      footer={
        <button className="adm-button" onClick={onClose}>
          关闭
        </button>
      }
    >
      {error ? (
        <Notice danger>{error}</Notice>
      ) : !data ? (
        <p role="status">正在读取执行记录…</p>
      ) : (
        <div className="adm-execution-detail">
          <div className="adm-detail-meta">
            <Status value={data.run.status} />
            <code>{data.run.id}</code>
          </div>
          <dl>
            <dt>模型版本</dt>
            <dd>
              {data.run.model?.displayName} · v{data.run.model?.configVersion}
            </dd>
            <dt>规则版本</dt>
            <dd>{data.run.decision?.ruleVersion ?? '未记录'}</dd>
            <dt>本轮能力</dt>
            <dd>
              {data.run.groups?.map((group: string) => groupLabels[group]).join('、') ||
                '四个原生工具'}
            </dd>
            <dt>Token 用量</dt>
            <dd>
              {data.run.usage?.status === 'known'
                ? `${number(data.run.usage.inputTokens)} 输入 / ${number(data.run.usage.outputTokens)} 输出`
                : '未知或未结算'}
            </dd>
          </dl>
          <h3>用户请求</h3>
          <pre>{data.run.text}</pre>
          <h3>执行轨迹</h3>
          <div className="adm-execution-events">
            {data.events.map((event: RecordData) => (
              <details key={event.eventId}>
                <summary>
                  <span>{event.type}</span>
                  <small>{date(event.occurredAt)}</small>
                </summary>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            ))}
          </div>
          {data.tasks?.length > 0 && (
            <>
              <h3>关联子任务</h3>
              {data.tasks.map((task: RecordData) => (
                <div className="adm-child-task" key={task.id}>
                  <strong>{task.title}</strong>
                  <Status value={task.status} />
                  <p>{task.summary ?? '尚无结果摘要'}</p>
                </div>
              ))}
            </>
          )}
          <p className="adm-footnote">本次查看已记录审计。</p>
        </div>
      )}
    </Modal>
  );
}
