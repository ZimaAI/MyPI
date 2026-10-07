import { test, expect } from '@playwright/test';
import { makeZip } from './helpers/zip.ts';

test('project ZIP import replaces confirmed workspace and shows binary files safely', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新的对话' }).click();
  await expect(page).toHaveURL(/\/c\//);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '导入项目', exact: true }).click();
  await page.getByLabel('项目 ZIP 文件').setInputFiles({
    name: 'project.zip',
    mimeType: 'application/zip',
    buffer: makeZip([
      { name: 'README.md', content: '# Imported project\nReviewed ZIP fixture' },
      { name: 'src/index.js', content: 'export const imported = true;\n' },
      { name: 'binary.bin', content: Buffer.from([0, 255, 1, 2]) },
      { name: '.pi/settings.json', content: '{"extension":"untrusted"}' },
    ]),
  });
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('项目已导入');
  await expect(page.getByRole('dialog')).toContainText('3 个文件');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.file-tree')).toContainText('src/index.js');
  await expect(page.locator('.file-tree')).not.toContainText('.pi');
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Reviewed ZIP fixture');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'binary.bin', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('二进制文件不提供文本预览');
  await expect(page.getByRole('button', { name: '下载文件' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(page.locator('.file-tree')).toContainText('src/index.js');
  await page.screenshot({
    path: 'docs/evidence/screenshots/empty-workspace-import.png',
    fullPage: true,
  });
});
