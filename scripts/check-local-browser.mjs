/** Explicit live-model acceptance for this localhost deployment; never run by pnpm verify. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
if (process.env.MYPI_LIVE_MODEL_CHECK !== 'true')
  throw new Error('Set MYPI_LIVE_MODEL_CHECK=true to authorize one live model task');
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const context = await browser.newContext({
  baseURL: 'http://localhost:3000',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
let conversationId;
try {
  await page.goto('/');
  await page.getByRole('button', { name: '新的对话' }).click();
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page).toHaveURL(/\/c\//);
  conversationId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: '原生模式', exact: true }).click();
  await page
    .getByRole('textbox', { name: '描述你的任务' })
    .fill(
      '本机部署验收：请使用 bash 工具执行 printf LOCAL_DOCKER_OK > local-deployment-check.txt，然后使用 read 工具读取该文件。完成后仅回复 LOCAL_DOCKER_OK，不做其他操作。',
    );
  await page.getByRole('button', { name: '发送消息' }).click();
  let snapshot;
  await expect
    .poll(
      async () => {
        snapshot = await (
          await context.request.get(`/api/v1/conversations/${conversationId}`)
        ).json();
        return snapshot.runs?.at(-1)?.status;
      },
      { timeout: 180000, intervals: [1000, 2000] },
    )
    .toMatch(/^(succeeded|failed|cancelled|timed_out|budget_exceeded|interrupted)$/);
  const run = snapshot.runs.at(-1);
  if (!['completed', 'succeeded'].includes(run.status))
    throw new Error(`Live run ${run.status}: ${JSON.stringify(run.error ?? run.failure ?? {})}`);
  await expect(page.locator('.message.assistant').last()).toContainText('LOCAL_DOCKER_OK');
  const fileResponse = await context.request.get(
    `/api/v1/conversations/${conversationId}/file?path=local-deployment-check.txt`,
  );
  const file = await fileResponse.json();
  expect(fileResponse.ok()).toBe(true);
  expect(file.content).toContain('LOCAL_DOCKER_OK');
  await page.reload();
  await expect(page.locator('.message.assistant').last()).toContainText('LOCAL_DOCKER_OK');
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await page.screenshot({
    path: 'docs/evidence/screenshots/local-docker-live.png',
    fullPage: true,
  });
  const report = {
    passed: true,
    model: run.model?.displayName,
    status: run.status,
    filePersisted: true,
    refreshRestored: true,
  };
  await writeFile('docs/evidence/local-docker-live.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  if (conversationId) {
    const me = await (await context.request.get('/api/v1/me')).json();
    const response = await context.request.delete(`/api/v1/conversations/${conversationId}`, {
      headers: { origin: 'http://localhost:3000', 'x-csrf-token': me.csrfToken },
    });
    if (!response.ok())
      console.error(`Acceptance conversation cleanup returned ${response.status()}`);
  }
  await browser.close();
}
