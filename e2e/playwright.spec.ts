import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000/api';

test('backend e2e flow (register -> webhook credits -> conversation)', async ({ request }) => {
  if (!process.env.RUN_E2E) {
    test.skip(true, 'Set RUN_E2E=1 to run full E2E tests against local server');
  }

  const email = `e2e+${Date.now()}@example.com`;
  const pass = 'password123';

  // register
  const reg = await request.post(`${BASE}/auth/register`, { data: { email, password: pass } });
  expect(reg.ok()).toBeTruthy();
  const regBody = await reg.json();
  const setCookie = reg.headers()['set-cookie'];
  expect(setCookie).toBeTruthy();

  const headers = { cookie: setCookie };

  // simulate stripe webhook to add credits
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test', mode: 'payment', metadata: { userId: regBody.user.id, credits: '50' }, amount_total: 5000 } },
  };
  const wh = await request.post(`${BASE}/billing/webhook`, { data: event });
  expect(wh.ok()).toBeTruthy();

  const bal = await request.get(`${BASE}/credits`, { headers });
  expect(bal.ok()).toBeTruthy();
  const balBody = await bal.json();
  expect(balBody.balance).toBeGreaterThanOrEqual(50);

  // create conversation
  const conv = await request.post(`${BASE}/conversations`, { headers, data: { title: 'E2E' } });
  expect(conv.ok()).toBeTruthy();
  const convBody = await conv.json();
  expect(convBody.id).toBeTruthy();

  // send message
  const msg = await request.post(`${BASE}/conversations/${convBody.id}/messages`, { headers, data: { content: 'Bonjour', modelId: process.env.DEFAULT_MODEL || 'gpt-4o-mini' } });
  expect(msg.ok()).toBeTruthy();
  const msgBody = await msg.json();
  expect(msgBody.assistant).toBeTruthy();
});
