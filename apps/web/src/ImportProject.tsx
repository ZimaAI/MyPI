import { useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from './api.ts';
import { Button, ErrorNotice, Modal } from './ui.tsx';

export function ImportProject({
  conversationId,
  revision,
  onClose,
  onComplete,
}: {
  conversationId: string;
  revision: string;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [kind, setKind] = useState<'zip' | 'github'>('zip'),
    [file, setFile] = useState<File>(),
    [url, setUrl] = useState(''),
    [ref, setRef] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [result, setResult] = useState<any>();
  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      let input: Record<string, unknown> = { kind, expectedRevision: revision };
      if (kind === 'zip') {
        if (!file || file.size > 10 * 1024 * 1024)
          throw new Error('请选择不超过 10 MiB 的 ZIP 文件');
        const archiveBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('无法读取文件'));
          reader.readAsDataURL(file);
        });
        input = { ...input, archiveBase64 };
      } else input = { ...input, url, ...(ref.trim() ? { ref: ref.trim() } : {}) };
      const response = await api(`/api/v1/conversations/${conversationId}/import`, {
        method: 'POST',
        body: input,
      });
      setResult(response);
      await onComplete();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="导入项目"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        ) : (
          <>
            <Button disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy || !confirmed || !revision || (kind === 'zip' ? !file : !url.trim())}
              onClick={() => void submit()}
            >
              <Upload size={15} />
              {busy ? '正在导入…' : '确认导入'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div role="status">
          <h3>项目已导入</h3>
          <p>
            {result.fileCount} 个文件 · {(result.totalBytes / 1024).toFixed(1)} KiB
          </p>
          {result.omittedPaths.length > 0 && (
            <p className="muted">
              已忽略 {result.omittedPaths.length} 个依赖、构建产物或配置路径。
            </p>
          )}
        </div>
      ) : (
        <div className="import-form">
          <p className="muted">
            从 ZIP 或公开 GitHub 仓库导入。导入完成后，再发送任务开始处理代码。
          </p>
          <div className="mode-switch">
            <button
              className={kind === 'zip' ? 'active' : ''}
              aria-pressed={kind === 'zip'}
              onClick={() => setKind('zip')}
              disabled={busy}
            >
              ZIP 文件
            </button>
            <button
              className={kind === 'github' ? 'active' : ''}
              aria-pressed={kind === 'github'}
              onClick={() => setKind('github')}
              disabled={busy}
            >
              GitHub 仓库
            </button>
          </div>
          {kind === 'zip' ? (
            <label>
              项目压缩包
              <input
                aria-label="项目 ZIP 文件"
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <small>压缩包最多 10 MiB，展开最多 32 MiB、2,000 个文件，单文件最多 2 MiB。</small>
            </label>
          ) : (
            <>
              <label>
                公开仓库地址
                <input
                  type="url"
                  placeholder="https://github.com/owner/repository"
                  value={url}
                  disabled={busy}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <label>
                分支、标签或提交（可选）
                <input
                  placeholder="留空使用默认分支"
                  value={ref}
                  maxLength={200}
                  disabled={busy}
                  onChange={(e) => setRef(e.target.value)}
                />
              </label>
            </>
          )}
          <label className="import-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>我确认用导入项目替换当前工作区文件。会话记录会保留，正在执行时无法导入。</span>
          </label>
        </div>
      )}
      <ErrorNotice error={error} />
    </Modal>
  );
}
