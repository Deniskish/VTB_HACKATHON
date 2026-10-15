import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { emptyFundingNeed, type FundingProfile, type FundingNeed, type FundingOpportunity } from './types';
import { parseFundingProfile, parseFundingNeed } from './input';
import { matchFundingOpportunity } from './matching';
import { catalogHash, type LiveCatalog } from './live';
import type { AssessOpportunity } from './notification-ai';
import { currentImported, measureKey } from './identity';
import type { NotificationDelivery } from './notification-delivery';
import { guestSession, requireIdentity, type IdentityResolver } from '../session';

// Business logic of support notifications: subscriptions, matching new measures,
// AI assessment and in-app storage. External delivery is optional (notification-delivery.ts).

/** external_delivery: consent to an external channel in addition to the in-app list. */
type Subscription = { user_id: string; profile: string; need: string; context_hash: string; external_delivery: number; created_at: number };
export class NotificationStore {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT PRIMARY KEY,profile TEXT NOT NULL,need TEXT NOT NULL,context_hash TEXT NOT NULL,external_delivery INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assessments(user_id TEXT NOT NULL,program_id TEXT NOT NULL,version TEXT NOT NULL,context_hash TEXT NOT NULL,next_at INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,program_id,version,context_hash));
      CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,program_id TEXT NOT NULL,version TEXT NOT NULL,context_hash TEXT NOT NULL,title TEXT NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,delivery_state TEXT NOT NULL,next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,program_id,version));
      CREATE TABLE IF NOT EXISTS worker_lock(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_keys(user_id TEXT NOT NULL,measure_key TEXT NOT NULL,notification_id TEXT NOT NULL,PRIMARY KEY(user_id,measure_key));`);
  }
  get(user: string) { return this.db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(user) as Subscription | undefined; }
  subscribe(user: string, profile: FundingProfile, need: FundingNeed, externalDelivery = false, now = Date.now()) {
    const hash = catalogHash({ profile, need }), previous = this.get(user);
    this.db.prepare(`INSERT INTO subscriptions(user_id,profile,need,context_hash,external_delivery,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile,need=excluded.need,context_hash=excluded.context_hash,external_delivery=excluded.external_delivery`).run(user, JSON.stringify(profile), JSON.stringify(need), hash, +externalDelivery, now);
    if (previous?.context_hash !== hash || !externalDelivery) this.db.prepare("UPDATE notifications SET delivery_state='cancelled' WHERE user_id=? AND delivery_state='pending'").run(user);
  }
  remove(user: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try { for (const table of ['subscriptions', 'assessments', 'notifications', 'notification_keys']) this.db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(user: string) { return this.db.prepare('SELECT id,program_id AS programId,title,reason,source,created_at AS createdAt,read_at AS readAt,delivery_state AS delivery FROM notifications WHERE user_id=? AND context_hash=(SELECT context_hash FROM subscriptions WHERE user_id=?) ORDER BY created_at DESC LIMIT 100').all(user, user); }
  status() { return { subscribers: (this.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get() as any).n,
    pending: (this.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE delivery_state='pending'").get() as any).n,
    deliveries: this.db.prepare('SELECT delivery_state AS state, COUNT(*) AS count FROM notifications GROUP BY delivery_state').all() }; }
}
export function notificationRouter(store: NotificationStore, aiConfigured: boolean, monitor?: () => { lastRun: string | null; lastError: string | null }, identity: IdentityResolver = guestSession) {
  const router = Router();
  router.use(requireIdentity(identity));
  router.get('/', (_req, res) => { const sub = store.get(res.locals.user); res.json({ enabled: !!sub, aiConfigured, monitor: monitor?.(), items: store.list(res.locals.user) }); });
  // In-app notifications. External delivery needs its own consent once a channel exists.
  router.put('/subscription', (req, res) => {
    try {
      const profile = parseFundingProfile(req.body?.profile), need = req.body?.need?.purpose ? parseFundingNeed(req.body.need) : { ...emptyFundingNeed };
      if (!profile.region || !(profile.okved || profile.industry || profile.goals?.length)) throw new Error('INVALID_PROFILE');
      store.subscribe(res.locals.user, profile, need); res.json({ enabled: true });
    } catch { res.status(400).json({ error: 'Укажите регион и направление бизнеса.', code: 'INVALID_PROFILE' }); }
  });
  router.delete('/subscription', (_req, res) => { store.remove(res.locals.user); res.json({ enabled: false }); });
  router.post('/read', (req, res) => {
    if (typeof req.body?.id !== 'string') { res.sendStatus(400); return; }
    store.db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(Date.now(), req.body.id, res.locals.user); res.json({ ok: true });
  });
  return router;
}
export function notificationCandidate(profile: FundingProfile, need: FundingNeed, o: FundingOpportunity, now = Date.now()) {
  if (o.status !== 'active' || !o.imported || o.imported.verification === 'pending'
    || !(o.imported.ongoing === true && o.imported.verification === 'verified') && (!Number.isFinite(Date.parse(o.imported.endsAt)) || Date.parse(o.imported.endsAt) <= now)) return false;
  const geography = o.imported.detail?.geography;
  if (geography?.length && profile.region) {
    const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/республика|область|край|город|\bг\.|\bобл\./g, '').replace(/[^а-яa-z0-9]/g, '');
    const region = normalize(profile.region);
    if (region && !geography.some((g) => /^(российская федерация|вся россия)$/i.test(g.trim())
      || !!normalize(g) && (normalize(g).includes(region) || region.includes(normalize(g))))) return false;
  }
  const match = matchFundingOpportunity(profile, { ...need, purpose: '' }, o, { now: new Date(now) });
  if (match.missingRequirements.some((r) => r.required) || match.amountFit === 'no') return false;
  // Cheap shortlist only; the model must still establish territorial and sector relevance from the source.
  const words = `${profile.industry ?? ''} ${(profile.goals ?? []).join(' ')} ${need.purpose}`.toLowerCase().match(/[а-яё]{5,}/g) ?? [];
  const title = `${o.title} ${o.description}`.toLowerCase();
  return /мал[оы].*предприним|субъект.*мсп/i.test(title) && profile.isSme !== 'no'
    || words.some((word) => title.includes(word.slice(0, 6)));
}
export class NotificationWorker {
  private owner = randomUUID();
  lastRun: string | null = null; lastError: string | null = null;
  constructor(private store: NotificationStore, private catalog: LiveCatalog, private assess?: AssessOpportunity, private delivery?: NotificationDelivery) {}
  async tick(now = Date.now()) {
    const db = this.store.db;
    const locked = db.prepare('INSERT INTO worker_lock VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE worker_lock.expires_at<?').run(this.owner, now + 900000, now);
    if (!locked.changes) return;
    try {
      const started = Date.now(); this.lastError = null;
      let remaining = 12;
      const subscriptions = db.prepare('SELECT * FROM subscriptions s ORDER BY COALESCE((SELECT MAX(next_at) FROM assessments a WHERE a.user_id=s.user_id),0),created_at').all() as Subscription[];
      if (this.assess) {
        for (const sub of subscriptions) {
          let perUser = 2;
          const profile = JSON.parse(sub.profile), need = JSON.parse(sub.need);
          const candidates = this.catalog.getCatalog().filter((o) => currentImported(o, now, this.catalog.status().checkedAt) && notificationCandidate(profile, need, o, now));
          for (let item of candidates) {
            const key = [sub.user_id, item.id, item.version, sub.context_hash];
            const identity = measureKey(item);
            if (db.prepare('SELECT 1 FROM notification_keys WHERE user_id=? AND measure_key=?').get(sub.user_id, identity)) continue;
            // Seed the identity ledger for notifications created before this migration.
            const legacy = db.prepare('SELECT id FROM notifications WHERE user_id=? AND program_id=? AND version=? LIMIT 1').get(sub.user_id, item.id, item.version) as { id: string } | undefined;
            if (legacy) { db.prepare('INSERT OR IGNORE INTO notification_keys VALUES(?,?,?)').run(sub.user_id, identity, legacy.id); continue; }
            const state = db.prepare('SELECT done,next_at FROM assessments WHERE user_id=? AND program_id=? AND version=? AND context_hash=?').get(...key) as any;
            if (remaining <= 0 || perUser <= 0 || Date.now() - started > 420000) break;
            if (state?.done || state?.next_at > now) continue;
            remaining--; perUser--;
            db.prepare('INSERT OR REPLACE INTO assessments VALUES(?,?,?,?,?,0)').run(...key, now + 3600000);
            try {
              item = await this.catalog.enrich(item.id) ?? item;
              if (!currentImported(item, Date.now(), this.catalog.status().checkedAt) || !item.imported?.detail?.complete || !item.imported.detail.accepting || !notificationCandidate(profile, need, item, Date.now())) continue;
              const result = await this.assess(profile, need, item);
              if (this.store.get(sub.user_id)?.context_hash !== sub.context_hash) continue;
              const current = this.catalog.getCatalog().find(o => o.id === item.id);
              if (!current || current.version !== item.version || !currentImported(current, Date.now(), this.catalog.status().checkedAt)
                || !notificationCandidate(profile, need, current, Date.now())) continue;
              db.exec('BEGIN IMMEDIATE');
              try {
                const noticeId = randomUUID();
                if (result.relevant) {
                  db.prepare('INSERT INTO notification_keys VALUES(?,?,?)').run(sub.user_id, measureKey(item), noticeId);
                  db.prepare(`INSERT INTO notifications(id,user_id,program_id,version,context_hash,title,reason,source,created_at,delivery_state,next_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(user_id,program_id,version) DO UPDATE SET context_hash=excluded.context_hash,reason=excluded.reason`)
                  .run(noticeId, sub.user_id, item.id, item.version, sub.context_hash, item.title, result.reason, item.source.url!, now, this.store.get(sub.user_id)?.external_delivery ? 'pending' : 'off', now);
                }
                db.prepare('UPDATE assessments SET done=1 WHERE user_id=? AND program_id=? AND version=? AND context_hash=?').run(...key);
                db.exec('COMMIT');
              } catch (error) { db.exec('ROLLBACK'); throw error; }
            } catch { this.lastError = 'analysis_unavailable'; }
          }
        }
      }
      if (this.delivery && await this.delivery.deliver(now, started + 420000)) this.lastError = 'delivery_unavailable';
      this.lastRun = new Date(now).toISOString();
    } finally { db.prepare('DELETE FROM worker_lock WHERE id=1 AND owner=?').run(this.owner); }
  }
}
