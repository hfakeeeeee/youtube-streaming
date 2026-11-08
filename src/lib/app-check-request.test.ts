import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appCheckRequest } from './app-check-request';

test('token acquisition failure does not send a request without protection', async () => {
  let sent = false;
  await assert.rejects(appCheckRequest('/api/search', {}, async () => { throw new Error('Token exchange failed'); }, async () => {
    sent = true;
    return new Response();
  }), /Token exchange failed/);
  assert.equal(sent, false);
});

test('App Check rejection refreshes once and preserves POST authentication and body', async () => {
  const refreshes: boolean[] = [];
  const seen: RequestInit[] = [];
  const response = await appCheckRequest('/api/voice/session', { method: 'POST', headers: { Authorization: 'Bearer user' }, body: '{"room":"test"}' }, async (refresh = false) => {
    refreshes.push(refresh);
    return refresh ? 'fresh' : 'old';
  }, async (_url, init) => {
    seen.push(init!);
    return seen.length === 1 ? Response.json({ error: 'App Check không hợp lệ hoặc đã hết hạn.' }, { status: 401 }) : Response.json({ ok: true });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(new Headers(seen[1].headers).get('X-Firebase-AppCheck'), 'fresh');
  assert.equal(new Headers(seen[1].headers).get('Authorization'), 'Bearer user');
  assert.equal(seen[1].body, seen[0].body);
  assert.equal(seen[1].method, 'POST');
});

test('repeated App Check rejection stops after one retry', async () => {
  let count = 0;
  const response = await appCheckRequest('/api/search', {}, async () => 'token', async () => {
    count++;
    return Response.json({ code: 'APP_CHECK_INVALID' }, { status: 401 });
  });
  assert.equal(count, 2);
  assert.equal(response.status, 401);
});

test('unrelated auth errors, rate limits and server failures are not retried', async () => {
  for (const status of [401, 429, 500]) {
    let count = 0;
    const response = await appCheckRequest('/api/voice/session', {}, async () => 'token', async () => {
      count++;
      return Response.json({ error: 'Other error' }, { status });
    });
    assert.equal(count, 1);
    assert.equal(response.status, status);
  }
});

test('backend without App Check configured remains compatible', async () => {
  await appCheckRequest('/api/search', {}, async () => '', async (_url, init) => {
    assert.equal(new Headers(init?.headers).has('X-Firebase-AppCheck'), false);
    return Response.json([]);
  });
});
