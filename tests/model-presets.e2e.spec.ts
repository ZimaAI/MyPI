import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('model catalog fills provider defaults, keeps edits, retries failures and fits mobile', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/models');
  await page.getByLabel('管理员账号').fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('Mypi-E2E-Only-12345');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await page.getByRole('button', { name: '模型管理', exact: true }).click();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    page.getByRole('combobox', { name: '提供商', exact: true }).locator('option'),
  ).toHaveCount(16);
  await expect(page.getByLabel('模型标识', { exact: true })).toHaveValue('deepseek-flash');
  await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('1048576');
  await expect(page.getByLabel('最大输出 Token', { exact: false })).toHaveValue('8192');
  await expect(page.getByLabel('启用模型', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('游客默认模型')).toBeDisabled();
  await page.getByRole('combobox', { name: '提供商', exact: true }).selectOption('openai');
  await expect(page.getByLabel('模型标识', { exact: true })).toHaveValue('gpt-6.1-sol');
  await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('1050000');
  await page.getByRole('combobox', { name: '提供商', exact: true }).selectOption('google');
  await expect(page.getByLabel('模型端点', { exact: false })).toHaveValue(
    'https://generativelanguage.googleapis.com/v1beta',
  );
  await page.getByRole('combobox', { name: '提供商', exact: true }).selectOption('minimax');
  await page.getByRole('combobox', { name: '服务地域', exact: true }).selectOption('minimax-intl');
  await expect(page.getByLabel('模型端点', { exact: false })).toHaveValue(
    'https://api.minimax.io/anthropic',
  );
  await expect(dialog.getByText('未知', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '提供商', exact: true }).selectOption('dashscope');
  await page.getByLabel('API Key', { exact: false }).fill('fixture-must-clear-on-region-change');
  await page
    .getByRole('combobox', { name: '服务地域', exact: true })
    .selectOption('dashscope-intl');
  await expect(page.getByLabel('API Key', { exact: false })).toHaveValue('');
  await expect(page.getByLabel('模型端点', { exact: false })).toHaveValue(
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  );
  await page
    .getByRole('combobox', { name: '官方模型预设', exact: true })
    .selectOption('qwen3.8-max');
  await expect(page.getByLabel('展示名称')).toHaveValue('Qwen 3.8 Max');
  await page.getByLabel('展示名称').fill('Catalog Browser Fixture');
  await page.getByLabel('上下文窗口', { exact: false }).fill('65432');
  await page.getByLabel('最大输出 Token', { exact: false }).fill('4567');
  await page.getByLabel('变更原因').fill('验证官方模型预设与自定义预算');
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await dialog.locator('.modal-content').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: 'docs/evidence/screenshots/model-presets-desktop.png',
    fullPage: true,
  });
  await page.route('**/api/v1/admin/models', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 503,
        json: { error: { code: 'FIXTURE_UNAVAILABLE', message: '保存服务暂不可用（测试）' } },
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('展示名称')).toHaveValue('Catalog Browser Fixture');
  await expect(page.getByLabel('最大输出 Token', { exact: false })).toHaveValue('4567');
  await page.unroute('**/api/v1/admin/models');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Catalog Browser Fixture' });
  await expect(row).toBeVisible();
  await expect(row.getByText('已停用', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '服务地域', exact: true })).toHaveValue(
    'dashscope-intl',
  );
  await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('65432');
  await expect(page.getByLabel('最大输出 Token', { exact: false })).toHaveValue('4567');
  await page.getByRole('button', { name: '恢复预设参数' }).click();
  await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('1000000');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator('.modal-content').evaluate((el) => {
    el.scrollTop = 0;
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'docs/evidence/screenshots/model-presets-mobile.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});
