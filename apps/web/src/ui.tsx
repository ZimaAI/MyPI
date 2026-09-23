import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, X, Inbox } from 'lucide-react';
export function Button({
  children,
  className = '',
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={`btn ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {onRetry && <Button onClick={onRetry}>重试</Button>}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox size={26} />
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => trigger?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭弹窗">
          <X size={19} />
        </button>
      </div>
      <div className="modal-content">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
export const statuses: Record<string, string> = {
  accepted: '已接收',
  queued: '等待中',
  running: '运行中',
  waiting_children: '等待子任务',
  cancelling: '正在取消',
  cancelled: '已取消',
  succeeded: '已完成',
  completed: '已完成',
  failed: '失败',
  timed_out: '已超时',
  budget_exceeded: '预算不足',
  interrupted: '已中断',
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  blocked: '受阻',
  active: '进行中',
  paused: '已暂停',
  complete: '已完成',
  conflict: '合并冲突',
  expired: '已到期',
};
export function Status({ status }: { status: string }) {
  return (
    <Badge
      tone={
        ['succeeded', 'completed', 'done', 'complete'].includes(status)
          ? 'success'
          : ['failed', 'timed_out', 'budget_exceeded'].includes(status)
            ? 'danger'
            : ['running', 'waiting_children', 'cancelling', 'doing'].includes(status)
              ? 'warning'
              : 'neutral'
      }
    >
      <span className="status-dot" />
      {statuses[status] ?? status}
    </Badge>
  );
}
