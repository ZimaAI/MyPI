import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('workspace: template, real SDK stream, file view, native mode, persistence and safe Markdown', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '把想法，写成 可运行的代码。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新的对话' })).toBeEnabled();
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/screenshots/chat-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '新的对话' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page).toHaveURL(/\/c\//);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '先读懂这个项目' }).click();
  await expect(page.getByRole('textbox', { name: '描述你的任务' })).toHaveValue(
    '使用搜索工具查找项目入口',
  );
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.message.assistant').last()).toContainText('已完成检查');
  await expect(page.locator('.tool-counts')).toContainText('0');
  await expect(page.locator('.timeline')).toContainText('工具执行完成');
  await page.reload();
  await expect(page.locator('.message.assistant').last()).toContainText('已完成检查');
  await expect(page.locator('.message.user')).toHaveCount(1);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: 'README.md' }).click();
  await expect(page.getByRole('dialog')).toContainText('MyPI JavaScript workspace');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '原生模式', exact: true }).click();
  await page.getByRole('textbox', { name: '描述你的任务' }).fill('使用搜索工具');
  await expect(page.locator('.intent-hint')).toContainText('原生模式固定四个基础工具');
  await page.getByRole('textbox', { name: '描述你的任务' }).fill('显示恶意HTML测试');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.message.assistant').last()).toContainText('内容仅作文本展示');
  await expect.poll(() => page.evaluate(() => (window as any).__mypiInjected)).toBeUndefined();
  expect(errors).toEqual([]);
});
test('explicit delegation returns independent task cards and an origin summary', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新的对话' }).click();
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page).toHaveURL(/\/c\//);
  await page.getByRole('button', { name: '让两个子代理并行协作' }).click();
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.getByRole('tab', { name: /并行任务/ }).click();
  await expect(page.locator('.task-card').filter({ hasText: '检查实现' })).toContainText('已完成');
  await expect(page.locator('.task-card').filter({ hasText: '检查测试' })).toContainText('已完成');
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await page.screenshot({ path: 'docs/evidence/screenshots/chat-parallel.png', fullPage: true });
});
test('mobile drawers, IME, focus and viewport do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '描述你的任务' })).toBeVisible();
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('button', { name: '新的对话' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开执行面板' }).click();
  await expect(page.getByRole('complementary', { name: '执行面板' })).toBeVisible();
  await page.getByRole('button', { name: '关闭执行面板' }).click();
  const input = page.getByRole('textbox', { name: '描述你的任务' });
  await input.fill('输入法尚未确认');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await expect(input).toHaveValue(/^输入法尚未确认\n?$/);
  await expect(page).toHaveURL(/\/$/);
  await input.dispatchEvent('compositionend');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/screenshots/chat-mobile.png', fullPage: true });
});
