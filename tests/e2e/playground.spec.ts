import { test, expect } from '@playwright/test';

test('/play loads with default snippet rendered in iframe', async ({ page }) => {
  await page.goto('/play');
  await expect(page.locator('.play-editor')).toBeVisible();
  // The compiler is fetched from esm.sh — give it time
  const iframe = page.frameLocator('.play-iframe');
  await expect(iframe.locator('h1')).toBeVisible({ timeout: 10_000 });
});

test('typing in the editor recompiles', async ({ page }) => {
  await page.goto('/play');
  // Wait for initial compile to populate the iframe.
  const iframe = page.frameLocator('.play-iframe');
  await expect(iframe.locator('h1')).toBeVisible({ timeout: 10_000 });
  // Replace the source. Use fill() to atomically swap the textarea value;
  // the playground listens on the `input` event which fill() dispatches.
  const editor = page.locator('.play-editor');
  await editor.fill('<h1>e2e marker</h1>');
  await expect(iframe.locator('h1')).toHaveText('e2e marker', { timeout: 6000 });
});

test('clicking a preset replaces the source', async ({ page }) => {
  await page.goto('/play');
  await page.waitForTimeout(1500);
  await page.locator('[data-preset="conditional"]').click();
  await expect(page.locator('.play-editor')).toHaveValue(/\{#if user\.admin\}/);
});
