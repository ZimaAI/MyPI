import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import {
  ArrowUp,
  ArrowUpRight,
  Box,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Download,
  FileCode2,
  Folder,
  GitBranch,
  Layers3,
  ListTodo,
  Loader2,
  LockKeyhole,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PanelRight,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { ImportProject } from './ImportProject.tsx';
import { api, bootstrap, errorText } from './api.ts';
import { emptyView, eventTypes, hydrate, reduceEvent, type ViewState } from './events.ts';
import { Button, Modal, Badge, ErrorNotice, EmptyState, Status } from './ui.tsx';
import { matchIntent, GROUPS } from '../../../packages/policy/src/index.ts';
import {
  terminalRun,
  type AgentEvent,
  type CapabilityGroup,
  type Mode,
} from '../../../packages/contracts/src/index.ts';
const groupIcons = {
  search: Search,
  delegate: GitBranch,
  workflow: Layers3,
  background: Terminal,
  session: ListTodo,
};
const groupText = {
  search: '文件、内容与只读 Git',
  delegate: '独立上下文，事件回传',
  workflow: '有界多阶段任务编排',
  background: '长期进程与有界日志',
  session: '工作项与目标记录',
};
const shortcuts: Record<CapabilityGroup, string> = {
  search: '使用搜索工具查找项目入口',
  delegate: '使用子代理分别检查实现和测试',
  workflow: '使用工作流编排检查与修复',
  background: '在后台运行测试',
  session: '使用任务管理工具创建待办',
};
const templates = [
  { id: 'javascript-starter', name: 'JavaScript 工具库', detail: 'Node.js 函数与离线单元测试' },
  { id: 'web-starter', name: '静态网页', detail: 'HTML、CSS 和 JavaScript' },
  { id: 'empty', name: '空白项目', detail: '从 README 开始' },
];
export default function Chat({
  route,
  navigate,
}: {
  route: string;
  navigate: (path: string) => void;
}) {
  const client = useQueryClient(),
    me = useQuery({ queryKey: ['me'], queryFn: bootstrap }),
    conversations = useQuery({
      queryKey: ['conversations'],
      queryFn: () => api<{ items: any[]; nextCursor: string | null }>('/api/v1/conversations'),
      enabled: !!me.data,
    });
  const conversationId = route.startsWith('/c/') ? route.slice(3) : undefined;
  const [view, setView] = useState<ViewState>(emptyView),
    [conversation, setConversation] = useState<any>(),
    [mode, setMode] = useState<Mode>('explicit'),
    [modelId, setModelId] = useState(''),
    [text, setText] = useState(''),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [connection, setConnection] = useState('idle'),
    [panel, setPanel] = useState('tools'),
    [navOpen, setNavOpen] = useState(false),
    [panelOpen, setPanelOpen] = useState(false),
    [newOpen, setNewOpen] = useState(false),
    [template, setTemplate] = useState('javascript-starter'),
    [file, setFile] = useState<any>(),
    [copied, setCopied] = useState(false),
    [danger, setDanger] = useState<'delete' | 'archive' | null>(null),
    [menuOpen, setMenuOpen] = useState(false),
    [info, setInfo] = useState(false),
    [importOpen, setImportOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    composing = useRef(false),
    sequence = useRef(0),
    lastKey = useRef<{ text: string; key: string } | undefined>(undefined);
  const working = Object.values(view.runs).filter((r) => !terminalRun(r.status)),
    current = working.at(-1),
    preview = matchIntent(text, mode, 'human', me.data?.intentRules);
  const disabledReason = !me.data
    ? '正在建立临时身份'
    : !me.data.allowedModels.length
      ? '管理员尚未配置可用模型'
      : !me.data.publicExecutionEnabled
        ? '公开执行尚未开启'
        : me.data.quota.usedRootRuns >= me.data.quota.dailyRootRuns
          ? '今日请求额度已用完'
          : conversation?.status === 'archived'
            ? '此会话已归档'
            : '';
  const workspace = useQuery({
    queryKey: ['workspace', conversationId],
    queryFn: () => api<any>(`/api/v1/conversations/${conversationId}/workspace`),
    enabled: !!conversationId && panel === 'files',
  });
  const processes = useQuery({
    queryKey: ['processes', conversationId],
    queryFn: () => api<{ items: any[] }>(`/api/v1/conversations/${conversationId}/processes`),
    enabled: !!conversationId && panel === 'tasks',
  });
  useEffect(() => {
    if (!modelId && me.data?.allowedModels.length)
      setModelId(
        (me.data.allowedModels.find((m) => m.defaultForGuests) ?? me.data.allowedModels[0]).id,
      );
  }, [me.data, modelId]);
  useEffect(() => {
    if (!conversationId || !me.data) {
      setView(emptyView());
      setConversation(undefined);
      setConnection('idle');
      return;
    }
    let disposed = false,
      source: EventSource | undefined;
    setError(undefined);
    setConnection('connecting');
    const connect = async () => {
      try {
        const snapshot = await api<any>(`/api/v1/conversations/${conversationId}`);
        if (disposed) return;
        sequence.current = snapshot.lastSequence;
        setView(hydrate(snapshot));
        setConversation(snapshot.conversation);
        setMode(snapshot.conversation.mode);
        source = new EventSource(
          `/api/v1/conversations/${conversationId}/events?after=${snapshot.lastSequence}`,
        );
        source.onopen = () => setConnection('connected');
        source.onerror = () => {
          if (!disposed) setConnection('reconnecting');
        };
        for (const type of eventTypes)
          source.addEventListener(type, (raw) => {
            if (disposed) return;
            try {
              const event = JSON.parse((raw as MessageEvent).data) as AgentEvent;
              if (type === 'stream.reset') {
                source?.close();
                void connect();
                return;
              }
              if (event.sequence <= sequence.current) return;
              setView((v) => {
                const next = reduceEvent(v, event);
                sequence.current = next.sequence;
                return next;
              });
              if (['run.completed', 'quota.updated', 'policy.revoked'].includes(type))
                void client.invalidateQueries({ queryKey: ['me'] });
              if (type === 'process.updated')
                void client.invalidateQueries({ queryKey: ['processes', conversationId] });
              if (type === 'run.completed') {
                void client.invalidateQueries({ queryKey: ['workspace', conversationId] });
                void api<any>(`/api/v1/conversations/${conversationId}`)
                  .then((snapshot) => {
                    if (!disposed)
                      setView((v) => ({
                        ...v,
                        workItems: snapshot.workItems ?? [],
                        goals: snapshot.goals ?? [],
                      }));
                  })
                  .catch(() => {});
              }
            } catch {
              setError('事件恢复失败，请刷新会话');
            }
          });
      } catch (e) {
        if (!disposed) {
          setError(e);
          setConnection('failed');
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      source?.close();
    };
  }, [conversationId, me.data?.principalId, client]);
  useEffect(() => {
    const el = scroll.current;
    if (view.messages.length && el && el.scrollHeight - el.scrollTop - el.clientHeight < 180)
      el.scrollTop = el.scrollHeight;
  }, [view.messages]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false);
        setPanelOpen(false);
        setMenuOpen(false);
      }
    };
    addEventListener('keydown', escape);
    return () => removeEventListener('keydown', escape);
  }, []);
  const insert = (value: string) => {
    setText(value);
    composer.current?.focus();
  };
  async function createConversation() {
    setPending(true);
    setError(undefined);
    try {
      const c = await api<any>('/api/v1/conversations', {
        method: 'POST',
        body: { mode, templateId: template },
      });
      await client.invalidateQueries({ queryKey: ['conversations'] });
      setNewOpen(false);
      setNavOpen(false);
      navigate(`/c/${c.id}`);
      return c.id as string;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setPending(false);
    }
  }
  async function send() {
    if (composing.current || pending || disabledReason || !text.trim()) return;
    const input = text;
    setPending(true);
    setError(undefined);
    try {
      let id = conversationId;
      if (!id) id = await createConversation();
      if (!id) return;
      setPending(true);
      if (lastKey.current?.text !== input)
        lastKey.current = { text: input, key: crypto.randomUUID() };
      const accepted = await api<any>(`/api/v1/conversations/${id}/runs`, {
        method: 'POST',
        body: { text: input, mode, ...(modelId ? { modelId } : {}) },
        idempotencyKey: lastKey.current.key,
      });
      setView((v) => ({
        ...v,
        messages: v.messages.some((m) => m.id === accepted.runId + ':human')
          ? v.messages
          : [
              ...v.messages,
              { id: accepted.runId + ':human', runId: accepted.runId, role: 'user', text: input },
            ],
        runs: { ...v.runs, [accepted.runId]: { id: accepted.runId, status: accepted.status } },
      }));
      setText('');
      lastKey.current = undefined;
      void client.invalidateQueries({ queryKey: ['conversations'] });
      requestAnimationFrame(() => {
        if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
      });
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  async function cancel(id: string, kind = 'runs') {
    try {
      await api(`/api/v1/${kind}/${id}/cancel`, { method: 'POST' });
    } catch (e) {
      setError(e);
    }
  }
  async function changeMode(next: Mode) {
    setMode(next);
    if (conversation) {
      try {
        const c = await api<any>(`/api/v1/conversations/${conversationId}`, {
          method: 'PATCH',
          body: { mode: next, expectedVersion: conversation.version },
        });
        setConversation(c);
      } catch (e) {
        setError(e);
      }
    }
  }
  async function mutateConversation() {
    if (!conversationId) return;
    setPending(true);
    try {
      await api(
        `/api/v1/conversations/${conversationId}`,
        danger === 'delete'
          ? { method: 'DELETE' }
          : { method: 'PATCH', body: { archived: true, expectedVersion: conversation.version } },
      );
      await client.invalidateQueries({ queryKey: ['conversations'] });
      setDanger(null);
      navigate('/');
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  async function openFile(path: string) {
    try {
      setFile(
        await api(`/api/v1/conversations/${conversationId}/file?path=${encodeURIComponent(path)}`),
      );
      setCopied(false);
    } catch (e) {
      setError(e);
    }
  }
  async function downloadFile() {
    try {
      const result = await api<{ artifactId: string }>(
        `/api/v1/conversations/${conversationId}/artifacts`,
        { method: 'POST', body: { path: file.path } },
      );
      const a = document.createElement('a');
      a.href = `/api/v1/artifacts/${result.artifactId}/download`;
      a.click();
    } catch (e) {
      setError(e);
    }
  }
  const selectPanel = (value: string) => {
    setPanel(value);
    setPanelOpen(true);
  };
  const tasks = Object.values(view.tasks),
    processList = processes.data?.items ?? Object.values(view.processes);
  return (
    <div className="page-shell">
      {(navOpen || panelOpen) && (
        <button
          aria-label="关闭侧面板"
          className="drawer-scrim"
          onClick={() => {
            setNavOpen(false);
            setPanelOpen(false);
          }}
        />
      )}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="会话导航">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <img className="brand-mark" src="/logo.svg" alt="" width="35" height="35" />
          <span>
            <strong>MyPI</strong>
            <small>CODING AGENT</small>
          </span>
        </a>
        <Button className="new-chat" onClick={() => setNewOpen(true)} disabled={!me.data}>
          <Plus size={18} />
          新的对话<span className="key-hint">＋</span>
        </Button>
        <div className="section-label">工作空间</div>
        <button
          className="nav-item active"
          onClick={() => {
            setNavOpen(false);
            setPanelOpen(false);
          }}
        >
          <MessageSquare size={18} />
          <span>对话工作台</span>
        </button>
        <button className="nav-item" onClick={() => selectPanel('files')}>
          <Folder size={18} />
          <span>项目文件</span>
        </button>
        <div className="section-label">最近的会话</div>
        <div className="conversation-list">
          {conversations.isLoading ? (
            <div className="skeleton" />
          ) : conversations.data?.items.length ? (
            conversations.data.items.map((c) => (
              <button
                key={c.id}
                className={`conversation-link ${c.id === conversationId ? 'selected' : ''}`}
                onClick={() => {
                  navigate(`/c/${c.id}`);
                  setNavOpen(false);
                }}
                title={c.title}
              >
                {c.title}
                {c.status === 'archived' && <small>已归档</small>}
              </button>
            ))
          ) : (
            <p className="side-empty">你的新想法，从这里开始。</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="quota-box">
            <div className="between">
              <span>今日体验额度</span>
              <strong>
                {me.data
                  ? `${Math.max(0, me.data.quota.dailyRootRuns - me.data.quota.usedRootRuns)} / ${me.data.quota.dailyRootRuns}`
                  : '—'}
              </strong>
            </div>
            <div className="quota-track">
              <span
                style={{
                  width: me.data
                    ? `${Math.max(0, 100 * (1 - me.data.quota.usedRootRuns / (me.data.quota.dailyRootRuns || 1)))}%`
                    : '0%',
                }}
              />
            </div>
            <small>
              {me.data
                ? `已使用 ${me.data.quota.usedTokens.toLocaleString()} Tokens`
                : '正在读取额度'}
            </small>
          </div>
          <button className="nav-item" onClick={() => navigate('/admin/login')}>
            <Settings2 size={17} />
            <span>管理后台</span>
            <LockKeyhole size={13} />
          </button>
          <div className="account">
            <span className="avatar">G</span>
            <div>
              <strong>临时访客</strong>
              <small>
                {me.data ? me.data.principalId.slice(0, 8) : '连接中…'} · 历史保留 24 小时
              </small>
            </div>
            <ShieldCheck size={16} />
          </div>
        </div>
      </aside>
      <main className="shell-main">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-button mobile-nav"
              aria-label="打开导航"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>MyPI</span>
              <ChevronRight size={13} />
              <strong>对话工作台</strong>
              <span className="desktop-detail">{conversation?.title ?? '新想法，新可能'}</span>
            </div>
          </div>
          <div className="row">
            <Badge tone={me.data?.publicExecutionEnabled ? 'success' : 'neutral'}>
              <span className="status-dot" />
              {me.data?.publicExecutionEnabled ? '执行已开启' : '执行尚未开启'}
            </Badge>
            <button className="icon-button" aria-label="了解工作台" onClick={() => setInfo(true)}>
              <CircleHelp size={18} />
            </button>
            <button
              className="icon-button toggle-inspector"
              aria-label="打开执行面板"
              onClick={() => setPanelOpen(true)}
            >
              <PanelRight size={19} />
            </button>
          </div>
        </header>
        <div className="chat-grid">
          <section className="chat-column">
            <div className="chat-toolbar">
              <div className="row model-control">
                <Box size={17} />
                <label className="sr-only" htmlFor="model">
                  选择模型
                </label>
                <select
                  id="model"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  disabled={!me.data?.allowedModels.length}
                >
                  {!me.data?.allowedModels.length && <option value="">尚未配置模型</option>}
                  {me.data?.allowedModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <div className="mode-switch" aria-label="工具模式">
                  {(['native', 'explicit'] as Mode[]).map((value) => (
                    <button
                      key={value}
                      aria-pressed={mode === value}
                      className={mode === value ? 'active' : ''}
                      onClick={() => void changeMode(value)}
                    >
                      {value === 'native' ? '原生模式' : '按需加载'}
                    </button>
                  ))}
                </div>
                {conversation && (
                  <div className="menu-wrap">
                    <button
                      className="icon-button"
                      aria-label="会话操作"
                      onClick={() => setMenuOpen(!menuOpen)}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {menuOpen && (
                      <div className="context-menu">
                        <button
                          onClick={() => {
                            setDanger('archive');
                            setMenuOpen(false);
                          }}
                        >
                          归档会话
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => {
                            setDanger('delete');
                            setMenuOpen(false);
                          }}
                        >
                          <Trash2 size={14} />
                          删除会话
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {working.length > 0 && (
              <div className="running-strip">
                <Loader2 size={14} className="spin" />
                <Status status={current.status} />
                <span>模式与模型更改将在下轮生效</span>
                <Button variant="ghost" onClick={() => void cancel(current.id)}>
                  <Square size={12} />
                  取消请求
                </Button>
              </div>
            )}
            {connection === 'reconnecting' && (
              <div className="connection-notice">连接中断，正在从已保存的位置恢复…</div>
            )}
            <div ref={scroll} className="chat-scroll">
              <div className="thread">
                <ErrorNotice
                  error={error ?? me.error ?? view.error}
                  onRetry={() => {
                    setError(undefined);
                    void me.refetch();
                  }}
                />
                {view.messages.length === 0 ? (
                  <div className="welcome">
                    <div className="welcome-icon">
                      <Code2 size={29} strokeWidth={1.5} />
                    </div>
                    <p className="eyebrow">YOUR IDEAS. YOUR AGENT.</p>
                    <h1>
                      把想法，写成
                      <br />
                      <span>可运行的代码。</span>
                    </h1>
                    <p className="welcome-intro">
                      描述任务，让 MyPI 帮你理解代码、完成修改。
                      <br className="desktop-break" />
                      需要更强的能力时，再明确告诉它。
                    </p>
                    <div className="examples">
                      {[
                        {
                          Icon: Code2,
                          title: '从一个小改动开始',
                          description: '补充输入校验和单元测试 · 仅四个原生工具',
                          text: '请检查 sum 函数，为它补充输入校验和单元测试。',
                        },
                        {
                          Icon: Search,
                          title: '先读懂这个项目',
                          description: '明确调用搜索工具 · 按需加载搜索能力',
                          text: shortcuts.search,
                        },
                        {
                          Icon: GitBranch,
                          title: '让两个子代理并行协作',
                          description: '独立检查实现与测试 · 主对话无需等待',
                          text: shortcuts.delegate,
                        },
                      ].map(({ Icon, title, description, text }) => (
                        <button className="example" key={title} onClick={() => insert(text)}>
                          <span className="example-icon">
                            <Icon size={20} />
                          </span>
                          <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    </div>
                    <div className="welcome-foot">
                      <span>
                        <ShieldCheck size={14} />
                        工作区执行
                      </span>
                      <span>
                        <MessageSquare size={14} />
                        免注册体验
                      </span>
                      <span>
                        <Layers3 size={14} />
                        按需能力
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="messages">
                    {view.messages.map((message) => (
                      <article key={message.id} className={`message ${message.role}`}>
                        <div className="message-header">
                          <span
                            className={message.role === 'user' ? 'avatar small' : 'assistant-mark'}
                          >
                            {message.role === 'user' ? '你' : <Code2 size={16} />}
                          </span>
                          <strong>{message.role === 'user' ? '你' : 'MyPI'}</strong>
                          {message.streaming && <span className="muted tiny">正在生成</span>}
                          <button
                            className="icon-button copy-message"
                            aria-label="复制消息"
                            onClick={() => void navigator.clipboard.writeText(message.text)}
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <div className="message-body">
                          {message.role === 'user' ? (
                            <p className="user-text">{message.text}</p>
                          ) : (
                            <ReactMarkdown
                              skipHtml
                              components={{
                                a: (props) => (
                                  <a {...props} target="_blank" rel="noreferrer noopener" />
                                ),
                                pre: ({ children }) => <pre>{children}</pre>,
                              }}
                            >
                              {message.text}
                            </ReactMarkdown>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="composer-area">
              <div className="cap-shortcuts">
                {(Object.keys(GROUPS) as CapabilityGroup[]).map((g) => {
                  const Icon = groupIcons[g];
                  return (
                    <button key={g} onClick={() => insert(shortcuts[g])}>
                      <Icon size={14} />
                      {GROUPS[g].label}
                    </button>
                  );
                })}
              </div>
              <div className="composer">
                <textarea
                  ref={composer}
                  aria-label="描述你的任务"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={16384}
                  placeholder="描述你的任务，或明确说：请使用搜索工具……"
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      !composing.current
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-bottom">
                  <button className="workspace-picker" onClick={() => setNewOpen(true)}>
                    <Folder size={15} />
                    {conversation ? '当前项目工作区' : '选择模板工作区'}
                  </button>
                  <button
                    className="send-button"
                    aria-label={working.length ? '发送并排队' : '发送消息'}
                    title={disabledReason || 'Enter 发送'}
                    disabled={!!disabledReason || !text.trim() || pending}
                    onClick={() => void send()}
                  >
                    {pending ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} />}
                  </button>
                </div>
              </div>
              <div className="intent-hint">
                <span className={preview.groups.length ? 'matched' : ''}>
                  <ShieldCheck size={14} />
                  {text
                    ? preview.groups.length
                      ? '本轮预览：' + preview.groups.map((g) => GROUPS[g].label).join('、')
                      : preview.reasons[0]
                    : '明确请求时，才启用扩展能力'}
                </span>
                <span className="desktop-detail">Enter 发送 · Shift + Enter 换行</span>
              </div>
              {disabledReason && (
                <div className="execution-note">{disabledReason}。你仍可浏览模板、准备任务。</div>
              )}
              <p className="composer-footer">
                勿提交生产凭据或敏感数据 · 临时工作区默认保留 24 小时 ·{' '}
                <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
                  浙ICP备2026076087号-1
                </a>
              </p>
            </div>
          </section>
          <aside className={`inspector ${panelOpen ? 'open' : ''}`} aria-label="执行面板">
            <div className="inspector-head">
              <strong>执行面板</strong>
              <Badge tone={connection === 'connected' ? 'success' : 'neutral'}>
                {connection === 'connected' ? '已连接' : conversationId ? '连接中' : '等待请求'}
              </Badge>
              <button
                className="icon-button close-inspector"
                aria-label="关闭执行面板"
                onClick={() => setPanelOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="inspector-tabs" role="tablist">
              {[
                ['tools', '工具与轨迹'],
                ['tasks', '并行任务'],
                ['files', '文件'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={panel === key}
                  className={panel === key ? 'active' : ''}
                  onClick={() => setPanel(key)}
                >
                  {label}
                  {key === 'tasks' && tasks.length > 0 && <span>{tasks.length}</span>}
                </button>
              ))}
            </div>
            <div className="inspector-body">
              {panel === 'tools' && (
                <>
                  <section className="tool-card">
                    <div className="between">
                      <strong>当前模型工具</strong>
                      <Badge>{working.length ? '执行中' : '空闲'}</Badge>
                    </div>
                    <div className="tool-counts">
                      <div>
                        <b>{view.surface.baseCount}</b>
                        <small>原生工具</small>
                      </div>
                      <span />
                      <div className="primary-text">
                        <b>{view.surface.extensionCount}</b>
                        <small>MyPI 扩展工具</small>
                      </div>
                    </div>
                    <div className="tool-chips">
                      {['read', 'write', 'edit', 'bash'].map((t) => (
                        <code key={t}>{t}</code>
                      ))}
                    </div>
                    <p>{view.surface.reason}</p>
                  </section>
                  <h3 className="panel-title">按需能力组</h3>
                  <div className="capability-list">
                    {(Object.keys(GROUPS) as CapabilityGroup[]).map((g) => {
                      const Icon = groupIcons[g],
                        active = view.surface.groups.includes(g);
                      return (
                        <div className={`capability ${active ? 'enabled' : ''}`} key={g}>
                          <span className="capability-icon">
                            <Icon size={18} />
                          </span>
                          <div>
                            <strong>{GROUPS[g].label}</strong>
                            <small>{groupText[g]}</small>
                          </div>
                          <span className="capability-state">{active ? '本轮启用' : '未加载'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="safety-note">
                    <ShieldCheck size={18} />
                    <span>
                      {me.data?.publicExecutionEnabled
                        ? '工具每次执行均由服务端校验授权。'
                        : '执行器尚未就绪时，公开工具执行保持关闭。'}
                    </span>
                  </div>
                  <h3 className="panel-title">最近轨迹</h3>
                  {view.events.length ? (
                    <div className="timeline">
                      {view.events
                        .filter((e) => !['message.delta', 'tool.output'].includes(e.type))
                        .slice(-12)
                        .reverse()
                        .map((e) => (
                          <div key={e.eventId}>
                            <span className="timeline-dot" />
                            <strong>{eventLabel(e)}</strong>
                            <small>
                              {new Date(e.occurredAt).toLocaleTimeString('zh-CN', {
                                hour12: false,
                              })}{' '}
                              · #{e.sequence}
                            </small>
                            {e.type === 'tool.surface.changed' && <p>{String(e.payload.reason)}</p>}
                            {e.type === 'provider.tools' && (
                              <p>实际 Provider：{(e.payload.names as string[]).length} 个工具</p>
                            )}
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="muted tiny">发送第一个请求后，工具轨迹会出现在这里。</p>
                  )}
                </>
              )}
              {panel === 'tasks' && (
                <>
                  <div className="between panel-title">
                    <h3>独立子任务</h3>
                    <Badge>{tasks.length}</Badge>
                  </div>
                  {tasks.length ? (
                    tasks.map((t) => (
                      <div className="task-card" key={t.id}>
                        <div className="between">
                          <Status status={t.status} />
                          {['running', 'queued'].includes(t.status) && (
                            <button
                              className="text-button"
                              onClick={() => void cancel(t.id, 'tasks')}
                            >
                              取消
                            </button>
                          )}
                        </div>
                        <h3>{t.title}</h3>
                        <small>{t.role} · 独立 Pi 会话</small>
                        <small className="mono">来源 {t.originRunId?.slice(0, 8)}</small>
                        {t.summary && <p>{t.summary}</p>}
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      title="还没有并行任务"
                      description="明确要求使用子代理，任务完成后会自动回传。"
                    />
                  )}
                  <h3 className="panel-title">后台进程</h3>
                  <ErrorNotice error={processes.error} />
                  {processList.length ? (
                    processList.map((p) => (
                      <div className="task-card" key={p.processId}>
                        <div className="between">
                          <Status status={p.status} />
                          {p.status === 'running' && (
                            <button
                              className="text-button"
                              onClick={async () => {
                                try {
                                  await api(
                                    `/api/v1/conversations/${conversationId}/processes/${p.processId}/stop`,
                                    { method: 'POST' },
                                  );
                                  void processes.refetch();
                                } catch (e) {
                                  setError(e);
                                }
                              }}
                            >
                              停止
                            </button>
                          )}
                        </div>
                        <h3>{p.title}</h3>
                        <pre>
                          {p.logs
                            ?.slice(-8)
                            .map((l: any) => l.text)
                            .join('\n')}
                        </pre>
                      </div>
                    ))
                  ) : (
                    <p className="muted tiny">暂无后台进程。离开页面不会延长进程租约。</p>
                  )}
                  <h3 className="panel-title">工作项与目标</h3>
                  {[...view.workItems, ...view.goals].map((item) => (
                    <div className="work-item" key={item.id}>
                      <ListTodo size={16} />
                      <span>{item.title}</span>
                      <Status status={item.status} />
                    </div>
                  ))}
                  {!view.workItems.length && !view.goals.length && (
                    <p className="muted tiny">计划与执行状态分别记录。</p>
                  )}
                </>
              )}
              {panel === 'files' && (
                <>
                  <div className="between panel-title">
                    <h3>项目文件</h3>
                    {conversationId && (
                      <button className="text-button" onClick={() => void workspace.refetch()}>
                        刷新
                      </button>
                    )}
                  </div>
                  <ErrorNotice error={workspace.error} />
                  {workspace.isLoading ? (
                    <div className="skeleton tall" />
                  ) : workspace.data?.files?.length ? (
                    <div className="file-tree">
                      {workspace.data.files.map((f: any) => (
                        <button key={f.path} onClick={() => void openFile(f.path)}>
                          <FileCode2 size={16} />
                          <span>{f.path}</span>
                          <ChevronRight size={13} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="选择一个项目模板"
                      description="创建对话后即可浏览自己的工作区文件。"
                    >
                      <Button onClick={() => setNewOpen(true)}>
                        <Plus size={15} />
                        创建工作区
                      </Button>
                    </EmptyState>
                  )}
                  {conversationId && (
                    <div className="import-actions">
                      <Button
                        disabled={
                          !me.data?.importsEnabled ||
                          working.length > 0 ||
                          !workspace.data?.revision
                        }
                        onClick={() => setImportOpen(true)}
                      >
                        导入项目
                      </Button>
                      {!me.data?.importsEnabled && (
                        <small className="muted">项目导入尚未启用</small>
                      )}
                    </div>
                  )}
                  {workspace.data?.patches?.map((patch: any) => (
                    <div className="task-card" key={patch.id}>
                      <h3>子任务变更</h3>
                      <small>
                        {patch.files?.length} 个文件 · 基于 {patch.baseRevision?.slice(0, 8)}
                      </small>
                      <Button
                        onClick={() =>
                          setFile({ path: 'changes.patch', content: patch.patch, patch })
                        }
                      >
                        查看 Diff
                      </Button>
                    </div>
                  ))}
                  <div className="safety-note">
                    <LockKeyhole size={17} />
                    <span>生成的代码以纯文本展示。HTML 和脚本不会在此页面执行。</span>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      </main>
      {newOpen && (
        <Modal
          title="开始一段新的对话"
          onClose={() => setNewOpen(false)}
          footer={
            <>
              <Button onClick={() => setNewOpen(false)}>取消</Button>
              <Button
                variant="primary"
                disabled={pending || !me.data}
                onClick={() => void createConversation()}
              >
                {pending ? '正在创建…' : '创建工作区'}
              </Button>
            </>
          }
        >
          <p className="muted">选择一个离线模板，所有修改保存在你的临时工作区。</p>
          <div className="template-options">
            {templates.map((t) => (
              <label key={t.id} className={template === t.id ? 'chosen' : ''}>
                <input
                  type="radio"
                  name="template"
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                />
                <Box size={20} />
                <span>
                  <strong>{t.name}</strong>
                  <small>{t.detail}</small>
                </span>
                {template === t.id && <Check size={18} />}
              </label>
            ))}
          </div>
          <ErrorNotice error={error} />
        </Modal>
      )}
      {importOpen && conversationId && (
        <ImportProject
          conversationId={conversationId}
          revision={workspace.data?.revision}
          onClose={() => setImportOpen(false)}
          onComplete={async () => {
            await workspace.refetch();
            const snapshot = await api<any>(`/api/v1/conversations/${conversationId}`);
            setConversation(snapshot.conversation);
          }}
        />
      )}
      {file && (
        <Modal
          title={file.path}
          onClose={() => setFile(undefined)}
          footer={
            <>
              <Button
                disabled={file.binary}
                onClick={async () => {
                  await navigator.clipboard.writeText(file.content);
                  setCopied(true);
                }}
              >
                {copied ? <CheckCheck size={15} /> : <Copy size={15} />}{' '}
                {copied ? '已复制' : '复制'}
              </Button>
              {file.patch ? (
                <Button
                  variant="primary"
                  onClick={async () => {
                    try {
                      await api(
                        `/api/v1/conversations/${conversationId}/patches/${file.patch.id}/apply`,
                        { method: 'POST', body: { baseRevision: file.patch.baseRevision } },
                      );
                      setFile(undefined);
                      void workspace.refetch();
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  应用变更
                </Button>
              ) : (
                <Button disabled={file.binary} onClick={() => void downloadFile()}>
                  <Download size={15} />
                  下载文件
                </Button>
              )}
            </>
          }
        >
          <pre className="file-preview">
            <code>{file.binary ? '二进制文件不提供文本预览。' : file.content || '（空文件）'}</code>
          </pre>
          {file.truncated && <p className="warning-text">文件较大，此处为截断预览。</p>}
          <ErrorNotice error={error} />
        </Modal>
      )}
      {danger && (
        <Modal
          title={danger === 'delete' ? '删除这段会话？' : '归档这段会话？'}
          onClose={() => setDanger(null)}
          footer={
            <>
              <Button onClick={() => setDanger(null)}>保留</Button>
              <Button variant="danger" disabled={pending} onClick={() => void mutateConversation()}>
                {danger === 'delete' ? '确认删除' : '确认归档'}
              </Button>
            </>
          }
        >
          <p>
            {danger === 'delete'
              ? '会话历史、临时工作区与产物将被清理，运行中的任务会被取消。'
              : '会话将停止接收新请求，并保留已有记录。'}
          </p>
          <strong>{conversation?.title}</strong>
        </Modal>
      )}
      {info && (
        <Modal title="你的想法，由你掌控" onClose={() => setInfo(false)}>
          <p>MyPI 以四个基础工具处理日常编码。只有你在本轮明确请求时，才会开放相应扩展工具。</p>
          <div className="info-grid">
            <ShieldCheck />
            <p>工具可见与执行授权分别校验。公开执行需要已验证的隔离运行环境。</p>
            <GitBranch />
            <p>子任务拥有独立上下文和项目副本，通过事件回传结果。</p>
            <LockKeyhole />
            <p>免注册身份仅保存在当前浏览器。清除 Cookie 后无法找回原记录。</p>
          </div>
          <p className="muted">当前数据来自实际服务；没有配置模型时不会生成演示回复。</p>
        </Modal>
      )}
    </div>
  );
}
function eventLabel(e: AgentEvent) {
  const p = e.payload as any;
  return (
    (
      {
        'run.accepted': '请求已接收',
        'run.started': '开始执行',
        'run.queued': '加入会话队列',
        'run.completed': '请求结束',
        'run.state.changed': '状态更新',
        'tool.surface.changed': '本轮工具面更新',
        'tool.started': `调用 ${p.toolName ?? '工具'}`,
        'tool.completed': p.ok ? '工具执行完成' : '工具调用失败',
        'provider.tools': '已核验模型工具面',
        'task.created': '子任务已创建',
        'task.state.changed': '子任务状态更新',
        'task.result.ready': '子任务结果已回传',
        'message.completed': '回复已保存',
        'quota.updated': '额度已结算',
        'process.updated': '后台进程更新',
        error: '执行出现错误',
        'workflow.updated': '工作流进度更新',
      } as Record<string, string>
    )[e.type] ?? e.type
  );
}
