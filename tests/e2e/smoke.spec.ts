import { test, expect } from '@playwright/test';

const pages = [
  { path: '/', title: /bangala/i },
  { path: '/docs', title: /Documentation|bangala/i },
  { path: '/docs/installation', title: /Installation/i },
  { path: '/docs/islands', title: /Islands/i },
  { path: '/docs/routing', title: /Routing/i },
  { path: '/docs/syntax', title: /Syntax/i },
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
