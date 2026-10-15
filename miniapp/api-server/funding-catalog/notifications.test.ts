import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { NotificationStore, NotificationWorker, notificationRouter, notificationCandidate } from './notifications';
import { NotificationDelivery, DeliveryRejected, type NotificationMessage } from './notification-delivery';
import { normalizeBudgetCard, type LiveCatalog } from './live';
import { emptyFundingNeed } from './types';
import { createOpportunityAssessor } from './notification-ai';
import { untilAborted } from './abort';

const now = Date.now();
const profile = { region: 'Москва', companyType: 'ООО' as const, isSme: 'yes' as const, industry: 'Производство', goals: ['запуск производства'] };
const session = (n: number) => `${'s'.repeat(42)}${n}`;
const opportunity = () => {
  const o = normalizeBudgetCard({ competitionId: '5f564f52-ac51-4496-9db7-bd7b282f7b64', title: 'Поддержка производства субъектами МСП', pppItemName: 'Организатор',
    startDate: new Date(now - 86400000).toISOString(), endDate: new Date(now + 86400000).toISOString(), isActive: true, isNotActive: false,
    selectionRecipients: [2], maxAmountForPersonInfo: '300 000,00 ₽', competitionType: 0 });
  o.imported!.detail = { text: 'Поддержка производства в Москве для субъектов МСП', complete: true, version: 'source-v1',
    checkedAt: new Date(now).toISOString(), startsAt: o.imported!.startsAt, endsAt: o.imported!.endsAt, accepting: true, geography: ['Москва'] }; return o;
};
function catalog(o = opportunity()) { return { getCatalog: () => [o], enrich: async () => o, status: () => ({ checkedAt: new Date(now).toISOString() }) } as unknown as LiveCatalog; }
// External channel stub: notifications are in-app only unless a transport is configured.
const delivering = (store: NotificationStore, send: (message: NotificationMessage) => Promise<void>) => new NotificationDelivery(store, catalog(), { send });
test('subscription API uses the session identity, strips identifiers, isolates reads and deletes', async () => {
  const store = new NotificationStore(':memory:'); const app = express(); app.use(express.json()); app.use(notificationRouter(store, true));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { 'X-Opora-Session': 'short' } })).status, 401);
    const headers = { 'X-Opora-Session': session(1), 'Content-Type': 'application/json' };
    const saved = await fetch(url + '/subscription', { method: 'PUT', headers, body: JSON.stringify({ user_id: '999', profile: { ...profile, inn: 'PRIVATE-INN', name: 'PRIVATE-NAME' }, need: emptyFundingNeed }) });
    assert.equal(saved.status, 200); assert.equal(store.get('999'), undefined);
    const rows = store.db.prepare('SELECT user_id, profile, external_delivery FROM subscriptions').all() as any[];
    assert.equal(rows.length, 1); assert.doesNotMatch(rows[0].profile, /PRIVATE/); assert.doesNotMatch(rows[0].user_id, new RegExp(session(1)));
    assert.equal(rows[0].external_delivery, 0);
    assert.equal((await (await fetch(url, { headers })).json() as any).enabled, true);
    const other = await (await fetch(url, { headers: { 'X-Opora-Session': session(2) } })).json() as any;
    assert.equal(other.enabled, false); assert.deepEqual(other.items, []);
    assert.equal((await fetch(url + '/subscription', { method: 'DELETE', headers })).status, 200);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get()!.n, 0);
  } finally { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); store.db.close(); }
});
test('background worker creates in-app notice and delivers it with consent and a transport; repeat scan does not duplicate', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true);
  let calls = 0, sent = 0;
  const worker = new NotificationWorker(store, catalog(), async () => { calls++; return { relevant: true, reason: 'Для производства', quotes: ['Поддержка производства'] }; }, delivering(store, async (message) => { sent++; assert.equal(message.programId, opportunity().id); assert.match(message.text, /Для производства/); }));
  try { await worker.tick(now); await worker.tick(now + 60000); assert.equal(calls, 1); assert.equal(sent, 1); assert.equal(store.list('123').length, 1); }
  finally { store.db.close(); }
});
test('in-app subscription never uses an external channel; no AI means no invented recommendations', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed); let sent = 0;
  try {
    await new NotificationWorker(store, catalog(), undefined, delivering(store, async () => { sent++; })).tick(now); assert.equal(store.list('123').length, 0);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'Совпадает отрасль', quotes: [] }), delivering(store, async () => { sent++; })).tick(now + 1);
    assert.equal(store.list('123').length, 1); assert.equal(sent, 0); assert.equal((store.list('123')[0] as any).delivery, 'off');
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'Без транспорта', quotes: [] })).tick(now + 2);
    assert.equal(store.list('123').length, 1);
  } finally { store.db.close(); }
});
test('temporary delivery failure retries from durable outbox, successful delivery is not sent again', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true); let sent = 0;
  const assess = async () => ({ relevant: true, reason: 'Есть связь с производством', quotes: [] });
  try {
    await new NotificationWorker(store, catalog(), assess, delivering(store, async () => { sent++; throw new DeliveryRejected(false); })).tick(now);
    assert.equal((store.list('123')[0] as any).delivery, 'pending');
    const restarted = new NotificationWorker(store, catalog(), assess, delivering(store, async () => { sent++; }));
    await restarted.tick(now + 59000); assert.equal(sent, 1);
    await restarted.tick(now + 61000); await restarted.tick(now + 120000);
    assert.equal(sent, 2); assert.equal((store.list('123')[0] as any).delivery, 'sent');
  } finally { store.db.close(); }
});
test('unsubscribe and changed business invalidate in-flight AI; permanent rejection stops retries; ambiguous result is not resent', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true); let sent = 0;
  try {
    await new NotificationWorker(store, catalog(), async () => { store.remove('123'); return { relevant: true, reason: 'test', quotes: [] }; }, delivering(store, async () => { sent++; })).tick(now);
    assert.equal(sent, 0); assert.equal(store.list('123').length, 0);
    store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'test', quotes: [] }), delivering(store, async () => { sent++; throw new DeliveryRejected(true); })).tick(now + 1);
    assert.equal((store.list('123')[0] as any).delivery, 'failed');
    await new NotificationWorker(store, catalog(), undefined, delivering(store, async () => { sent++; })).tick(now + 90000); assert.equal(sent, 1);
    store.db.prepare("UPDATE notifications SET delivery_state='pending', attempts=0, next_at=0").run();
    await new NotificationWorker(store, catalog(), undefined, delivering(store, async () => { sent++; throw new Error('timeout'); })).tick(now + 100000);
    assert.equal((store.list('123')[0] as any).delivery, 'unconfirmed');
    await new NotificationWorker(store, catalog(), undefined, delivering(store, async () => { sent++; })).tick(now + 200000); assert.equal(sent, 2);
  } finally { store.db.close(); }
});
test('closed, wrong applicant and unknown dates are excluded before AI', () => {
  const o = opportunity(); assert.ok(notificationCandidate(profile, emptyFundingNeed, o, now));
  assert.equal(notificationCandidate(profile, emptyFundingNeed, { ...o, status: 'closed' }, now), false);
  assert.equal(notificationCandidate({ ...profile, companyType: 'ИП' }, emptyFundingNeed, o, now), false);
  assert.equal(notificationCandidate(profile, emptyFundingNeed, { ...o, imported: { ...o.imported!, endsAt: '' } }, now), false);
});
test('AI evidence validation rejects fabricated quotes and malformed/provider-failure output', async () => {
  const o = opportunity(); let value: unknown = { relevant: true, reason: 'Поддержка производства', quotes: ['Поддержка производства в Москве'] };
  const assess = createOpportunityAssessor('https://model.test', 'test', async () => 'token', async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  assert.equal((await assess(profile, emptyFundingNeed, o)).relevant, true);
  value = { relevant: true, reason: 'Придумано', quotes: ['Гарантированное одобрение 100%'] };
  assert.equal((await assess(profile, emptyFundingNeed, o)).relevant, false);
  value = 'invalid'; await assert.rejects(assess(profile, emptyFundingNeed, o));
});
test('file-backed queue survives closing and reopening SQLite', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'opora-notices-'));
  let store = new NotificationStore(path.join(dir, 'notifications.sqlite'));
  try {
    store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'Производство', quotes: [] })).tick(now);
    store.db.close(); store = new NotificationStore(path.join(dir, 'notifications.sqlite'));
    let sent = 0;
    await new NotificationWorker(store, catalog(), undefined, delivering(store, async () => { sent++; })).tick(now + 1000);
    await new NotificationWorker(store, catalog(), undefined, delivering(store, async () => { sent++; })).tick(now + 2000);
    assert.equal(sent, 1); assert.equal((store.list('123')[0] as any).delivery, 'sent');
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('changed company hides previous notices, cancels delivery and rejects in-flight analysis', async () => {
  const store = new NotificationStore(':memory:');
  const changed = { ...profile, region: 'Томская область' };
  try {
    store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'Москва', quotes: [] })).tick(now);
    assert.equal(store.list('123').length, 1);
    store.subscribe('123', changed, emptyFundingNeed, true);
    assert.equal(store.list('123').length, 0);
    assert.equal((store.db.prepare('SELECT delivery_state FROM notifications').get() as any).delivery_state, 'cancelled');
    assert.equal(notificationCandidate(changed, emptyFundingNeed, opportunity(), now), false);
    store.remove('123'); store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => {
      store.subscribe('123', changed, emptyFundingNeed, true);
      return { relevant: true, reason: 'Старый профиль', quotes: [] };
    }).tick(now + 1000);
    assert.equal(store.db.prepare('SELECT id FROM notifications').get(), undefined);
  } finally { store.db.close(); }
});

test('database lease prevents concurrent workers from assessing or sending twice', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true);
  let release!: () => void, started!: () => void, sent = 0, calls = 0;
  const entered = new Promise<void>(r => { started = r; });
  const gate = new Promise<void>(r => { release = r; });
  const assess = async () => { calls++; started(); await gate; return { relevant: true, reason: 'Производство', quotes: [] }; };
  try {
    const first = new NotificationWorker(store, catalog(), assess, delivering(store, async () => { sent++; })).tick(now);
    await entered;
    await new NotificationWorker(store, catalog(), assess, delivering(store, async () => { sent++; })).tick(now + 1);
    release(); await first; assert.equal(calls, 1); assert.equal(sent, 1);
  } finally { release(); store.db.close(); }
});

test('shared requests stop blocking an aborted caller', async () => {
  const controller = new AbortController();
  const waiting = untilAborted(new Promise(() => {}), controller.signal); controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});
