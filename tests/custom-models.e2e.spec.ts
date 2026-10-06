import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('Ark plans and custom endpoints save, test, preserve edits and reset credential trust', async ({
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
  const provider = page.getByRole('combobox', { name: '提供商', exact: true });
  const endpoint = page.getByRole('combobox', { name: '服务端点', exact: true });
  const url = page.getByLabel('模型端点', { exact: false });
  const key = page.getByLabel('API Key', { exact: false });
  await provider.selectOption('volcengine-agent-plan');
  await expect(url).toHaveValue('https://ark.cn-beijing.volces.com/api/plan/v3');
  await expect(page.getByLabel('模型标识', { exact: true })).toHaveValue('ark-code-latest');
  await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('32768');
  await endpoint.selectOption('volcengine-agent-plan-anthropic');
  await expect(url).toHaveValue('https://ark.cn-beijing.volces.com/api/plan');
  await page.getByText('协议与思考设置', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '调用协议', exact: true })).toHaveValue(
    'anthropic-messages',
  );
  await page.getByRole('combobox', { name: '官方模型预设' }).selectOption('glm-5.3');
  await page.getByRole('button', { name: '恢复预设参数' }).click();
  await expect(page.getByRole('combobox', { name: '调用协议', exact: true })).toHaveValue(
    'anthropic-messages',
  );
  await key.fill('fixture-agent-key');
  await provider.selectOption('volcengine-coding-plan');
  await expect(key).toHaveValue('');
  await expect(url).toHaveValue('https://ark.cn-beijing.volces.com/api/coding/v3');
  await page
    .getByRole('combobox', { name: '调用协议', exact: true })
    .selectOption('openai-responses');
  await page.getByLabel('展示名称').fill('Coding Plan Browser Fixture');
  await key.fill('fixture-coding-key');
  await page.getByLabel('变更原因').fill('验证套餐专用端点');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const planRow = page.getByRole('row').filter({ hasText: 'Coding Plan Browser Fixture' });
  await planRow.getByRole('button', { name: '连接测试', exact: true }).click();
  await expect(planRow.getByText('测试通过', { exact: true })).toBeVisible();
  await planRow.getByRole('button', { name: '编辑', exact: true }).click();
  await endpoint.selectOption('custom');
  await url.fill('https://proxy.example.com/ark/coding/v3');
  await expect(key).toHaveAttribute('required', '');
  await key.fill('fixture-proxy-key');
  await page.getByLabel('变更原因').fill('使用自定义套餐网关');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(planRow.getByText('测试通过', { exact: true })).not.toBeVisible();
  await planRow.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(url).toHaveValue('https://proxy.example.com/ark/coding/v3');
  await expect(key).toHaveValue('');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await provider.selectOption('custom');
  await expect(endpoint).toHaveValue('custom');
  await expect(page.getByLabel('模型标识', { exact: true })).toHaveValue('');
  await url.fill('https://127.0.0.1/v1');
  await page.getByLabel('展示名称').fill('Custom Endpoint Browser Fixture');
  await page.getByLabel('模型标识', { exact: true }).fill('my-private-deployment');
  await key.fill('fixture-custom-key');
  await page.getByLabel('变更原因').fill('验证自定义模型端点');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('公网 HTTPS');
  await expect(page.getByLabel('模型标识', { exact: true })).toHaveValue('my-private-deployment');
  await url.fill('https://models.example.com/v1');
  await expect(key).toHaveValue('');
  await key.fill('fixture-custom-key');
  await page.getByText('协议与思考设置', { exact: true }).click();
  await page
    .getByRole('combobox', { name: '调用协议', exact: true })
    .selectOption('anthropic-messages');
  await page.getByLabel('上下文窗口', { exact: false }).fill('65536');
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await dialog.locator('.modal-content').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: 'docs/evidence/screenshots/custom-model-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const customRow = page.getByRole('row').filter({ hasText: 'Custom Endpoint Browser Fixture' });
  await customRow.getByRole('button', { name: '连接测试', exact: true }).click();
  await expect(customRow.getByText('测试通过', { exact: true })).toBeVisible();
  await customRow.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(url).toHaveValue('https://models.example.com/v1');
  await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('65536');
  await expect(key).toHaveValue('');
  await page.getByText('协议与思考设置', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '调用协议', exact: true })).toHaveValue(
    'anthropic-messages',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator('.modal-content').evaluate((el) => {
    el.scrollTop = 0;
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'docs/evidence/screenshots/custom-model-mobile.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});
