const { test, expect } = require('@playwright/test');

test('deployed export button is visibly and functionally disabled with no elections selected', async ({ page }, testInfo) => {
  await page.goto('https://joshuacwebdeveloper.github.io/election-notes/');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export elections' });
  const exportButton = dialog.getByRole('button', { name: 'Export', exact: true });
  await expect(exportButton).toBeDisabled();
  const style = await exportButton.evaluate(e => ({ background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, cursor: getComputedStyle(e).cursor, opacity: getComputedStyle(e).opacity }));
  console.log('DISABLED BUTTON COMPUTED STYLE', JSON.stringify(style));
  await page.screenshot({ path: testInfo.outputPath('export-zero-selected.png'), fullPage: true });
  expect(style.cursor).toBe('not-allowed');
  await dialog.getByRole('checkbox').first().check();
  await expect(dialog.getByRole('button', { name: /^Export [1-9]/ })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('export-selected.png'), fullPage: true });
});
