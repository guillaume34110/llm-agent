# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/playwright.spec.ts >> backend e2e flow (register -> webhook credits -> conversation)
- Location: e2e/playwright.spec.ts:5:5

# Error details

```
Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:58231
Call log:
  - → POST http://127.0.0.1:58231/api/auth/register
    - user-agent: Playwright/1.59.1 (arm64; macOS 15.6) node/22.20
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 66

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000/api';
  4  | 
  5  | test('backend e2e flow (register -> webhook credits -> conversation)', async ({ request }) => {
  6  |   if (!process.env.RUN_E2E) {
  7  |     test.skip(true, 'Set RUN_E2E=1 to run full E2E tests against local server');
  8  |   }
  9  | 
  10 |   const email = `e2e+${Date.now()}@example.com`;
  11 |   const pass = 'password123';
  12 | 
  13 |   // register
> 14 |   const reg = await request.post(`${BASE}/auth/register`, { data: { email, password: pass } });
     |                             ^ Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:58231
  15 |   expect(reg.ok()).toBeTruthy();
  16 |   const regBody = await reg.json();
  17 |   const setCookie = reg.headers()['set-cookie'];
  18 |   expect(setCookie).toBeTruthy();
  19 | 
  20 |   const headers = { cookie: setCookie };
  21 | 
  22 |   // simulate stripe webhook to add credits
  23 |   const event = {
  24 |     type: 'checkout.session.completed',
  25 |     data: { object: { id: 'cs_test', mode: 'payment', metadata: { userId: regBody.user.id, credits: '50' }, amount_total: 5000 } },
  26 |   };
  27 |   const wh = await request.post(`${BASE}/billing/webhook`, { data: event });
  28 |   expect(wh.ok()).toBeTruthy();
  29 | 
  30 |   const bal = await request.get(`${BASE}/credits`, { headers });
  31 |   expect(bal.ok()).toBeTruthy();
  32 |   const balBody = await bal.json();
  33 |   expect(balBody.balance).toBeGreaterThanOrEqual(50);
  34 | 
  35 |   // create conversation
  36 |   const conv = await request.post(`${BASE}/conversations`, { headers, data: { title: 'E2E' } });
  37 |   expect(conv.ok()).toBeTruthy();
  38 |   const convBody = await conv.json();
  39 |   expect(convBody.id).toBeTruthy();
  40 | 
  41 |   // send message
  42 |   const msg = await request.post(`${BASE}/conversations/${convBody.id}/messages`, { headers, data: { content: 'Bonjour', modelId: process.env.DEFAULT_MODEL || 'gpt-4o-mini' } });
  43 |   expect(msg.ok()).toBeTruthy();
  44 |   const msgBody = await msg.json();
  45 |   expect(msgBody.assistant).toBeTruthy();
  46 | });
  47 | 
```