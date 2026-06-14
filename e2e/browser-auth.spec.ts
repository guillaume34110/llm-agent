import { test, expect } from '@playwright/test';

const FRONTEND = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

test('browser register sets HttpOnly token and XSRF cookie', async ({ page }) => {
  const email = `e2e+${Date.now()}@example.com`;
  const pass = 'password123';

  await page.goto(FRONTEND);
  await page.waitForSelector('input[placeholder="email"]');

  await page.fill('input[placeholder="email"]', email);
  await page.fill('input[placeholder="password"]', pass);

  const [response] = await Promise.all([
    page.waitForResponse((resp) => resp.url().includes('/api/auth/register') && resp.request().method() === 'POST'),
    page.click('button:has-text("Register")'),
  ]);

  expect(response.ok()).toBeTruthy();

  // small delay to ensure browser persisted cookies
  await page.waitForTimeout(200);

  const cookies = await page.context().cookies();
  const tokenCookie = cookies.find((c) => c.name === 'token');
  const xsrfCookie = cookies.find((c) => c.name === 'XSRF-TOKEN');

  expect(tokenCookie).toBeTruthy();
  expect(tokenCookie?.httpOnly).toBe(true);

  expect(xsrfCookie).toBeTruthy();
  expect(xsrfCookie?.httpOnly).toBe(false);
});
