import { test, expect } from '@playwright/test';

const pages = [
  { path: '/', title: /bangala/i },
  { path: '/docs', title: /Documentation|bangala/i },
  { path: '/docs/installation', title: /Installation/i },
  { path: '/docs/project-structure', title: /Project structure/i },
  { path: '/docs/syntax', title: /syntax/i },
  { path: '/docs/components', title: /Components/i },
  { path: '/docs/islands', title: /Islands/i },
  { path: '/docs/routing', title: /Routing/i },
  { path: '/docs/layouts', title: /Layouts/i },
  { path: '/docs/static-generation', title: /Static Generation/i },
  { path: '/docs/examples', title: /Examples/i },
  { path: '/docs/from-nextjs', title: /From Next\.js/i },
  { path: '/docs/api', title: /API Reference/i },
  { path: '/docs/adapters', title: /Adapters/i },
  { path: '/play', title: /Playground/i },
  { path: '/vs/nextjs', title: /Next\.js/i },
  { path: '/benchmarks', title: /Benchmarks/i },
];

for (const { path, title } of pages) {
  test(`${path} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await page.waitForLoadState('networkidle');
    expect(errors, `errors on ${path}:\n${errors.join('\n')}`).toEqual([]);
  });
}

test('docs search opens with keyboard shortcut and filters results', async ({ page }) => {
  await page.goto('/docs');
  await page.keyboard.press('Control+K');
  await expect(page.locator('.docs-search-panel')).toBeVisible();
  await page.locator('.docs-search-field input').fill('layout');
  await expect(page.locator('.docs-search-result', { hasText: 'Layouts' })).toBeVisible();
});

test('docs search includes guides', async ({ page }) => {
  await page.goto('/docs');
  await page.keyboard.press('Control+K');
  await page.locator('.docs-search-field input').fill('next');
  await expect(page.locator('.docs-search-result', { hasText: 'From Next.js' })).toBeVisible();
});

test('docs search includes components', async ({ page }) => {
  await page.goto('/docs');
  await page.keyboard.press('Control+K');
  await page.locator('.docs-search-field input').fill('component');
  await expect(page.locator('.docs-search-result', { hasText: 'Components' })).toBeVisible();
});
