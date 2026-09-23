import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('administrator manages models, rules, visitors and audit with real API and responsive layout', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await context.request.post(`${baseURL}/api/v1/guest-sessions`, {
    headers: { origin: baseURL! },
    data: {},
  });
  await page.goto('/admin/login');
  await page.getByLabel('管理员账号').fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('Mypi-E2E-Only-12345');
  await page.getByRole('button', { name: '登录控制台' }).click();
  await expect(page.getByRole('heading', { name: '运行概览', exact: true })).toBeVisible();
  await expect(page.getByText('当前未封禁的临时身份')).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/screenshots/admin-desktop.png', fullPage: true });
  const session = await (await context.request.get(`${baseURL}/api/v1/admin/me`)).json();
  const adminHeaders = { origin: baseURL!, 'x-csrf-token': session.csrfToken };
  const originalPolicy = await (await context.request.get(`${baseURL}/api/v1/admin/policy`)).json();
  const originalRules = await (await context.request.get(`${baseURL}/api/v1/admin/rules`)).json();
  let addedModelId: string | undefined;
  let originalFailure = false;
  try {
    await page.getByRole('button', { name: '模型管理', exact: true }).click();
    await page.getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByLabel('展示名称').fill('Browser Fixture');
    await page.getByLabel('模型标识').fill('fixture');
    await page.getByLabel('API Key', { exact: false }).fill('sk-browser-test-only');
    await page.getByLabel('变更原因').fill('浏览器集成测试');
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    const modelRow = page.getByRole('row').filter({ hasText: 'Browser Fixture' });
    await expect(modelRow).toBeVisible();
    await expect(page.locator('body')).not.toContainText('sk-browser-test-only');
    const rows = await (await context.request.get(`${baseURL}/api/v1/admin/models`)).json();
    addedModelId = rows.items.find((row: any) => row.displayName === 'Browser Fixture').id;
    await modelRow.getByRole('button', { name: '连接测试', exact: true }).click();
    await expect(modelRow.getByText('测试通过', { exact: true })).toBeVisible();
    await modelRow.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('游客默认模型').check();
    await page.getByLabel('变更原因').fill('设置测试后的默认模型');
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    await expect(modelRow.getByText('游客默认', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'docs/evidence/screenshots/admin-models.png', fullPage: true });
    await page.getByRole('button', { name: '额度与规则', exact: true }).click();
    await expect(page.getByRole('heading', { name: '显式意图试验台' })).toBeVisible();
    await page.getByRole('button', { name: '否定表达', exact: true }).click();
    await page.getByRole('button', { name: '测试规则', exact: true }).click();
    await expect(page.getByText('不激活扩展工具', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新建规则草稿', exact: true }).click();
    await page.getByLabel('草稿名称').fill('浏览器词表回归');
    await page.getByLabel('搜索额外动作短语').fill('使用代码检索');
    await page.getByLabel('草稿变更原因').fill('验证有限词表发布流程');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.locator('.adm-rule-review-heading h3')).toHaveText('浏览器词表回归');
    await page.getByRole('button', { name: '运行黄金集校验', exact: true }).click();
    await expect(page.getByText('黄金集回归通过', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '发布此草稿', exact: true }).click();
    await page.getByLabel('发布或回滚原因').fill('发布浏览器校验后的词表');
    await page.getByRole('button', { name: '确认发布', exact: true }).click();
    await expect(page.getByText('新规则版本已生效。', { exact: true })).toBeVisible();
    await page.getByLabel('输入文本', { exact: true }).fill('使用代码检索');
    await page.getByRole('button', { name: '测试规则', exact: true }).click();
    await expect(page.getByText('匹配到明确意图', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'docs/evidence/screenshots/admin-rules.png', fullPage: true });
    await page
      .getByRole('row')
      .filter({ hasText: '内置 v1' })
      .getByRole('button', { name: '回滚至此版本' })
      .click();
    await page.getByLabel('发布或回滚原因').fill('恢复内置规则验证回滚');
    await page.getByRole('button', { name: '确认回滚', exact: true }).click();
    await expect(page.getByText('已切换到选定的历史版本。', { exact: true })).toBeVisible();
    await page.getByLabel('游客每日请求').fill('18');
    await page.getByLabel('发布原因').fill('浏览器测试发布预算策略');
    await page.getByRole('button', { name: '发布新策略', exact: true }).click();
    await expect(page.getByText(`当前生效版本 v${originalPolicy.version + 1}`)).toBeVisible();
    await page.screenshot({ path: 'docs/evidence/screenshots/admin-policy.png', fullPage: true });
    await page.getByRole('button', { name: '游客管理', exact: true }).click();
    await page.getByRole('button', { name: '封禁', exact: true }).first().click();
    await page.getByLabel('操作原因').fill('浏览器测试封禁');
    await page.getByRole('button', { name: '确认更新', exact: true }).click();
    await expect(page.getByText('已封禁', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '审计日志', exact: true }).click();
    await expect(page.getByText('visitor.updated', { exact: true }).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '打开管理导航' }).click();
    await page.getByRole('button', { name: '模型管理', exact: true }).click();
    await expect(page.getByRole('heading', { name: '模型管理', exact: true })).toBeVisible();
    await expect(page.locator('.adm-sidebar')).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, -240, 0)',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/evidence/screenshots/admin-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
  } catch (error) {
    originalFailure = true;
    throw error;
  } finally {
    try {
      if (originalRules.activeVersionId)
        await context.request.post(`${baseURL}/api/v1/admin/rules/rollback`, {
          headers: adminHeaders,
          data: { versionId: originalRules.activeVersionId, reason: '恢复测试前生效规则' },
        });
      const models = await (await context.request.get(`${baseURL}/api/v1/admin/models`)).json();
      const original = models.items.find((item: any) => item.id === 'fixture');
      if (original) {
        await context.request.post(`${baseURL}/api/v1/admin/models/fixture/test`, {
          headers: adminHeaders,
        });
        const refreshed = await (
          await context.request.get(`${baseURL}/api/v1/admin/models`)
        ).json();
        const current = refreshed.items.find((item: any) => item.id === 'fixture');
        await context.request.patch(`${baseURL}/api/v1/admin/models/fixture`, {
          headers: adminHeaders,
          data: {
            expectedVersion: current.version,
            defaultForGuests: true,
            reason: '恢复浏览器测试默认模型',
          },
        });
      }
      if (addedModelId) {
        const refreshed = await (
          await context.request.get(`${baseURL}/api/v1/admin/models`)
        ).json();
        const current = refreshed.items.find((item: any) => item.id === addedModelId);
        await context.request.patch(`${baseURL}/api/v1/admin/models/${addedModelId}`, {
          headers: adminHeaders,
          data: {
            expectedVersion: current.version,
            enabled: false,
            publicSelectable: false,
            defaultForGuests: false,
            reason: '关闭浏览器测试附加模型',
          },
        });
      }
      const latestPolicy = await (
        await context.request.get(`${baseURL}/api/v1/admin/policy`)
      ).json();
      await context.request.put(`${baseURL}/api/v1/admin/policy`, {
        headers: adminHeaders,
        data: { ...originalPolicy, version: latestPolicy.version, reason: '恢复测试前执行策略' },
      });
    } catch (error) {
      if (!originalFailure) throw error;
    }
  }
});
