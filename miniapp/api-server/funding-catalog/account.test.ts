import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { accountRouter } from '../account';
import { NotificationStore } from './notifications';
import { emptyFundingNeed } from './types';
const session = (id: number) => `${'a'.repeat(40)}${String(id).padStart(3, '0')}`;
const auth = (id: number) => ({ 'X-Opora-Session': session(id), 'Content-Type': 'application/json' });
test('session account persists company, rejects forged authority, isolates sessions and atomically removes subscriptions', async () => {
  const store = new NotificationStore(':memory:'), app = express(); app.use(express.json()); app.use(accountRouter(store));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (path = '', method = 'GET', body?: unknown, id = 100) => fetch(url + path, { method, headers: auth(id), body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { 'X-Opora-Session': 'not-a-session' } })).status, 401);
    const account = await (await call()).json() as any; assert.ok(account.id); assert.equal(account.revision, 0); assert.equal(account.identity, 'guest');
    const company = { inn: '7707083893', name: 'Проверка', region: 'Москва', okved: '10.82', industry: 'Производство', isSme: 'unknown', authority: 'verified', esiaVerified: true };
    const saved = await (await call('/company', 'PUT', { revision: 0, company })).json() as any;
    assert.equal(saved.company.inn, company.inn); assert.equal(saved.company.authority, undefined); assert.equal(saved.company.esiaVerified, undefined);
    assert.equal(saved.authority, 'unverified'); assert.equal(saved.canSubmitApplications, false);
    assert.equal((await (await call()).json() as any).company.name, company.name);
    assert.equal((await (await call('', 'GET', undefined, 200)).json() as any).company, null);
    assert.equal((await call('/company', 'PUT', { revision: 0, company })).status, 409);
    assert.equal((await call('/verification/esia', 'POST', {})).status, 503);
    const user = (store.db.prepare('SELECT user_id FROM accounts WHERE id=?').get(account.id) as { user_id: string }).user_id;
    assert.doesNotMatch(user, new RegExp(session(100)));
    store.subscribe(user, { region: 'Москва', industry: 'Производство' }, emptyFundingNeed);
    const removed = await (await call('/company', 'DELETE')).json() as any;
    assert.equal(removed.id, account.id); assert.equal(removed.company, null); assert.equal(removed.revision, 2); assert.equal(store.get(user), undefined);
    assert.equal((await call('/company', 'PUT', { revision: 2, company: { ...company, inn: '123' } })).status, 400);
  } finally { await new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); }); store.db.close(); }
});
