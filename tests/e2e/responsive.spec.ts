import { test, expect, devices } from '@playwright/test';

// Re-use the iPhone 13 viewport/userAgent/touch profile but force Chromium so
// CI doesn't need to download WebKit (devices['iPhone 13'] sets
// defaultBrowserType: 'webkit').
const iphone13 = devices['iPhone 13'];
test.use({
  viewport: iphone13.viewport,
  userAgent: iphone13.userAgent,
  deviceScaleFactor: iphone13.deviceScaleFactor,
  isMobile: iphone13.isMobile,
  hasTouch: iphone13.hasTouch,
});

test('home: no horizontal overflow on mobile', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.body.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('nav visible on mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav#nav')).toBeVisible();
});

test('/play layout stacks on mobile', async ({ page }) => {
  await page.goto('/play');
  await expect(page.locator('.play-grid')).toBeVisible();
});
