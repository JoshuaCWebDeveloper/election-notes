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

test('candidate selection works in contests and election data, and Cancel restores previous state', async ({ page }, testInfo) => {
  await page.goto('https://joshuacwebdeveloper.github.io/election-notes/');
  await page.getByRole('button', { name: /Example Local Election/ }).first().click();
  const contest = page.locator('.contest-editor').first();
  await contest.getByRole('button', { name: 'Make Selection' }).click();
  const candidate = contest.getByRole('checkbox', { name: /Select / }).first();
  await candidate.check();
  await expect(contest.locator('.included-row.candidate-chosen')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('contest-candidate-selected.png'), fullPage: true });
  await contest.getByRole('button', { name: 'Cancel' }).click();
  await expect(contest.locator('.included-row.candidate-chosen')).toHaveCount(0);
  const report = page.locator('.dashboard').filter({has: page.getByRole('heading', {name: 'Candidate Data Entry'})}).first();
  await report.getByRole('button', { name: 'Make Selection' }).click();
  await report.getByRole('checkbox', { name: /Select .* in election data/ }).first().check();
  await expect(report.locator('.score-card.candidate-chosen')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('election-data-selected.png'), fullPage: true });
});
