import { test, expect } from '@playwright/test';

test('counter island hydrates and increments', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('.live-demo bangala-island').first().locator('button');
  await expect(btn).toHaveText(/count=0/i);
  await btn.click();
  await expect(btn).toHaveText(/count=1/i);
});

test('theme toggle hydrates after idle', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('.live-demo bangala-island').nth(1).locator('button');
  await expect(btn).toHaveText(/Dark|Light/, { timeout: 4000 });
});

test('bytes counter hydrates when scrolled into view', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bytes-value').scrollIntoViewIfNeeded();
  await expect(page.locator('.bytes-value')).toHaveText('0', { timeout: 4000 });
});

test('all 3 islands eventually reach data-hydrated="true"', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bytes-value').scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.live-demo bangala-island')).every(
        (el) => (el as HTMLElement).dataset.hydrated === 'true',
      ),
    null,
    { timeout: 6000 },
  );
});
