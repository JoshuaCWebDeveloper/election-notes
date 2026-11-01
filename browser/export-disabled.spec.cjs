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

test('candidate selections are shared between election contests and data entry', async ({ page }, testInfo) => {
  await page.goto('https://joshuacwebdeveloper.github.io/election-notes/');
  await page.getByRole('button', { name: /Example Local Election/ }).first().click();
  const contest = page.locator('.contest-editor').first();
  const report = page.locator('.dashboard').filter({ has: page.getByRole('heading', { name: 'Candidate Data Entry' }) }).first();
  await contest.getByRole('button', { name: 'Make Selection' }).click();
  await contest.getByRole('checkbox', { name: 'Select Alex Example' }).click();
  await expect(contest.getByRole('button', { name: 'Make Selection' })).toBeVisible();
  await expect(report.locator('.score-card.candidate-chosen')).toHaveCount(1);
  const selectedLayout = await report.locator('.score-card.candidate-chosen').first().evaluate(card => {
    const icons = [...card.closest('.score-selection-row').querySelectorAll(':scope > input.selection-indicator')].map(el => el.getBoundingClientRect());
    const label = card.querySelector(':scope > span').getBoundingClientRect();
    return { iconCenters: icons.map(box => box.y + box.height / 2), labelCenter: label.y + label.height / 2 };
  });
  console.log('SELECTED CARD ALIGNMENT', JSON.stringify(selectedLayout));
  expect(selectedLayout.iconCenters).toHaveLength(1);
  for (const y of selectedLayout.iconCenters) expect(Math.abs(y - selectedLayout.labelCenter)).toBeLessThan(18);
  await page.screenshot({ path: testInfo.outputPath('selection-from-contest.png'), fullPage: true });
  await report.getByRole('button', { name: 'Make Selection' }).click();
  await page.screenshot({ path: testInfo.outputPath('selection-mode-checkbox-inside-card.png'), fullPage: true });
  const bounds = await report.locator('.score-selection-row').first().evaluate(row => {
    const card = row.getBoundingClientRect();
    const box = row.querySelector('input[type=checkbox]').getBoundingClientRect();
    return { card: { x: card.x, y: card.y, width: card.width, height: card.height }, checkbox: { x: box.x, y: box.y, width: box.width, height: box.height } };
  });
  console.log('SELECTION CARD GEOMETRY', JSON.stringify(bounds));
  expect(bounds.card.height).toBeGreaterThanOrEqual(72);
  expect(bounds.checkbox.x).toBeGreaterThan(bounds.card.x);
  expect(bounds.checkbox.x + bounds.checkbox.width).toBeLessThan(bounds.card.x + bounds.card.width);
  expect(bounds.checkbox.y).toBeGreaterThan(bounds.card.y);
  expect(bounds.checkbox.y + bounds.checkbox.height).toBeLessThan(bounds.card.y + bounds.card.height);

  await report.getByRole('checkbox', { name: /Select .* in election data/ }).nth(1).click();
  await expect(contest.locator('.included-row.candidate-chosen')).toHaveCount(2);
  await expect(report.getByRole('button', { name: 'Make Selection' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('selection-from-election-data.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('.contest-editor .included-row.candidate-chosen')).toHaveCount(2);
});
