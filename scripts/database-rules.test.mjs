import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Run with: firebase emulators:exec --only database --project demo-syncbox "node --test scripts/database-rules.test.mjs"
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!host) throw new Error('Run this test through the Firebase Database Emulator.');
const namespace = 'demo-syncbox-default-rtdb';
const base = `http://${host}`;

function token(uid) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: uid, user_id: uid, aud: 'demo-syncbox',
    iss: 'https://securetoken.google.com/demo-syncbox',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  })}.`;
}

async function request(path, method, value, uid = 'admin') {
  const auth = uid === 'admin' ? '' : `&auth=${token(uid)}`;
  return fetch(`${base}/${path}.json?ns=${namespace}${auth}`, {
    method, headers: { 'Content-Type': 'application/json', ...(uid === 'admin' ? { Authorization: 'Bearer owner' } : {}) },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}

test('room permissions: Co-host loop/settings and playback speeds through 4x', async () => {
  const rules = JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url), 'utf8'));
  assert.equal((await request('.settings/rules', 'PUT', rules)).status, 200);
  const meta = {
    name: 'Test room', hostUid: 'owner-user', createdAt: 1,
    coHosts: { cohost: true, other: true }, isPublic: false,
    sponsorBlockEnabled: false, sponsorCategories: ['sponsor'], loopMode: 'off',
  };
  const playback = { status: 'paused', position: 0, volume: 80, updatedAt: 1, revision: 1, changedBy: 'owner-user' };
  assert.equal((await request('rooms/TEST', 'PUT', {
    meta, playback, members: { 'owner-user': { role: 'host', online: true }, cohost: { role: 'listener' }, dj: { role: 'dj' }, listener: { role: 'listener' } },
  })).status, 200);
  // Reproduce the previous failure: val() cannot compare the coHosts object.
  const previousRules = structuredClone(rules);
  previousRules.rules.rooms.$roomId.meta['.validate'] += " && (!data.exists() || newData.child('coHosts').val() == data.child('coHosts').val() || data.child('hostUid').val() === auth.uid)";
  assert.equal((await request('.settings/rules', 'PUT', previousRules)).status, 200);
  assert.equal((await request('rooms/TEST/meta', 'PATCH', { loopMode: 'one' }, 'cohost')).status, 401);
  assert.equal((await request('.settings/rules', 'PUT', rules)).status, 200);
  for (const mode of ['one', 'all', 'off']) {
    assert.equal((await request('rooms/TEST/meta', 'PATCH', { loopMode: mode }, 'cohost')).status, 200);
  }
  for (const uid of ['dj', 'listener']) {
    assert.equal((await request('rooms/TEST/meta', 'PATCH', { loopMode: 'one' }, uid)).status, 401);
  }
  assert.equal((await request('rooms/TEST/meta', 'PATCH', { name: 'Updated', chatEnabled: false }, 'cohost')).status, 200);
  assert.equal((await request('rooms/TEST/meta', 'PATCH', { loopMode: 'invalid' }, 'cohost')).status, 401);
  for (const [path, value] of [['hostUid', 'cohost'], ['coHosts/other', null], ['coHosts/stranger', true], ['coHosts', null]]) {
    assert.equal((await request(`rooms/TEST/meta/${path}`, 'PUT', value, 'cohost')).status, 401);
  }
  assert.equal((await request('rooms/TEST/meta/coHosts/new-cohost', 'PUT', true, 'owner-user')).status, 200);
  for (const uid of ['owner-user', 'cohost', 'dj']) {
    assert.equal((await request('rooms/TEST/playback', 'PATCH', { playbackRate: 4 }, uid)).status, 200);
  }
  assert.equal((await request('rooms/TEST/playback', 'PATCH', { playbackRate: 4 }, 'listener')).status, 401);
  for (const playbackRate of [0, 4.25, '4']) {
    assert.equal((await request('rooms/TEST/playback', 'PATCH', { playbackRate }, 'cohost')).status, 401);
  }
  assert.equal((await request('rooms/TEST/members/owner-user/online', 'PUT', false)).status, 200);
  assert.equal((await request('rooms/TEST/meta', 'PATCH', { hostUid: 'dj', 'coHosts/stranger': true }, 'dj')).status, 401);
  assert.equal((await request('rooms/TEST/meta', 'PATCH', { hostUid: 'cohost' }, 'cohost')).status, 200);
});
