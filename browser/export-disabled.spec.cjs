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

test('elections sort by election date and candidate screen shows contest memberships', async ({ page }, testInfo) => {
  await page.goto('https://joshuacwebdeveloper.github.io/election-notes/');
  await page.getByRole('button', { name: /^Candidates/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Elections', exact: true })).toBeVisible();
  await expect(page.locator('.candidate-election-membership').first()).toContainText('Example Local Election');
  await expect(page.locator('.candidate-election-membership').first()).toContainText('Example Local Election contest');
  await page.screenshot({ path: testInfo.outputPath('candidate-memberships.png'), fullPage: true });
});

test('merge candidate preview and commit preserve membership', async ({ page }, testInfo) => {
  await page.goto('https://joshuacwebdeveloper.github.io/election-notes/');
  await page.getByRole('button', { name: /^Candidates/ }).first().click();
  const listRows = page.locator('.merge-candidate-list-row');
  await expect(listRows).toHaveCount(2);
  const listGeometry = await listRows.first().evaluate(row => {
    const container = row.getBoundingClientRect();
    const button = row.querySelector('button').getBoundingClientRect();
    return { containerWidth: container.width, buttonWidth: button.width, buttonHeight: button.height };
  });
  console.log('CANDIDATE LIST GEOMETRY', JSON.stringify(listGeometry));
  expect(listGeometry.buttonWidth).toBeGreaterThan(130);
  expect(listGeometry.buttonHeight).toBeGreaterThan(35);
  await page.screenshot({ path: testInfo.outputPath('candidate-list-before-merge.png'), fullPage: true });
  const merge = page.getByRole('button', { name: /Merge candidates/ });
  await expect(merge).toBeDisabled();
  const boxes = page.locator('.merge-candidate-list-row > input[type=checkbox]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(merge).toBeEnabled();
  await merge.click();
  const dialog = page.getByRole('dialog', { name: 'Merge duplicate candidates' });
  await expect(dialog.getByText('Resulting name:')).toBeVisible();
  await expect(dialog.getByText(/Example Local Election contest/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('candidate-merge-preview.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Merge candidates' }).click();
  await expect(page.locator('.merge-candidate-list-row')).toHaveCount(1);
  await expect(page.locator('.candidate-election-membership').first()).toContainText('Example Local Election contest');
  await page.screenshot({ path: testInfo.outputPath('candidate-merge-result.png'), fullPage: true });
});

test('election issue cards have aligned fixed-width points and remove columns', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto('https://joshuacwebdeveloper.github.io/election-notes/');
  await page.getByRole('button', { name: /Example Local Election/ }).first().click();
  const issueRows = page.locator('.election-editor-columns .issue-row');
  await expect(issueRows).toHaveCount(2);
  const geometry = await issueRows.evaluateAll(rows => rows.map(row => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, width: box.width };
    };
    return { grid: getComputedStyle(row).display, details: rect(row.querySelector('.issue-card-copy')), points: rect(row.querySelector('.points-input')), input: rect(row.querySelector('.points-input input')), remove: rect(row.querySelector('button')) };
  }));
  console.log('ISSUE CARD GRID GEOMETRY', JSON.stringify(geometry));
  for (const row of geometry) {
    expect(row.grid).toBe('grid');
    expect(row.points.width).toBeGreaterThan(95);
    expect(Math.abs(row.points.width - row.input.width)).toBeLessThan(2);
  }
  for (const key of ['details', 'points', 'remove']) {
    expect(Math.abs(geometry[0][key].x - geometry[1][key].x)).toBeLessThan(1);
    expect(Math.abs(geometry[0][key].width - geometry[1][key].width)).toBeLessThan(1);
  }
  await issueRows.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('election-issue-grid-desktop.png'), fullPage: true });
  await page.setViewportSize({width: 1100, height: 900});
  const narrow = await issueRows.evaluateAll(rows => rows.map(row => {
    const r = row.getBoundingClientRect(), points = row.querySelector('.points-input').getBoundingClientRect(), input = row.querySelector('input').getBoundingClientRect();
    return { left: r.x, right: r.right, pointsX: points.x, pointsW: points.width, inputRight: input.right };
  }));
  expect(Math.abs(narrow[0].pointsX - narrow[1].pointsX)).toBeLessThan(1);
  for (const row of narrow) expect(row.inputRight).toBeLessThan(row.right);
  await page.screenshot({ path: testInfo.outputPath('election-issue-grid-narrow.png'), fullPage: true });
  // Reproduce the long-description case in issue #9 without modifying stored data.
  await issueRows.first().locator('.issue-card-copy span').first().evaluate(element => {
    element.textContent = 'A lengthy issue description that covers multiple policies and considerations, including several interconnected proposals and a detailed explanation that wraps across many lines in the narrow issue card.';
  });
  const longDescription = await issueRows.evaluateAll(rows => rows.map(row => {
    const text = row.querySelector('.issue-card-copy').getBoundingClientRect();
    const points = row.querySelector('.points-input').getBoundingClientRect();
    const remove = row.querySelector('button').getBoundingClientRect();
    return { textHeight: text.height, pointsX: points.x, pointsWidth: points.width, removeX: remove.x };
  }));
  expect(longDescription[0].textHeight).toBeGreaterThan(longDescription[1].textHeight);
  expect(Math.abs(longDescription[0].pointsX - longDescription[1].pointsX)).toBeLessThan(1);
  expect(Math.abs(longDescription[0].pointsWidth - longDescription[1].pointsWidth)).toBeLessThan(1);
  expect(Math.abs(longDescription[0].removeX - longDescription[1].removeX)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath('election-issue-grid-long-description.png'), fullPage: true });
});
