import type { LiveCatalog } from './live';
import { currentImported } from './identity';
import { notificationCandidate, type NotificationStore } from './notifications';

// Delivery of stored notifications through an external channel (durable outbox).
// The MVP has no external channel: notifications are shown inside the app only.
// A channel (e-mail, bank push, messenger) implements NotificationTransport and is
// passed to NotificationWorker; matching and AI assessment do not change.
export type NotificationMessage = { user: string; programId: string; title: string; text: string };
export interface NotificationTransport {
  /** Resolves only after the channel confirms acceptance of the message. */
  send(message: NotificationMessage): Promise<void>;
}
/** The channel answered and did not accept the message. Any other error is ambiguous: it may have been delivered. */
export class DeliveryRejected extends Error {
  constructor(readonly permanent: boolean, message = 'DELIVERY_REJECTED') { super(message); }
}

export class NotificationDelivery {
  constructor(private store: NotificationStore, private catalog: LiveCatalog, private transport: NotificationTransport) {}
  /** Sends due notifications with external-delivery consent. Returns the number of failed attempts. */
  async deliver(now: number, deadline: number) {
    const db = this.store.db;
    let failures = 0;
    const pending = db.prepare("SELECT * FROM notifications WHERE delivery_state='pending' AND next_at<=? ORDER BY created_at LIMIT 10").all(now) as any[];
    const deliveredUsers = new Set<string>();
    for (const notification of pending) {
      if (Date.now() > deadline) break;
      if (deliveredUsers.has(notification.user_id)) continue;
      const sub = this.store.get(notification.user_id), item = this.catalog.getCatalog().find((o) => o.id === notification.program_id);
      if (!sub?.external_delivery || sub.context_hash !== notification.context_hash || item?.version !== notification.version || item?.status !== 'active') {
        db.prepare("UPDATE notifications SET delivery_state='cancelled' WHERE id=?").run(notification.id); continue;
      }
      try {
        if (!currentImported(item, Date.now(), this.catalog.status().checkedAt)) continue;
        const fresh = await this.catalog.enrich(item.id);
        if (!fresh?.imported?.detail?.complete || !fresh.imported.detail.accepting || fresh.version !== notification.version
          || !currentImported(fresh, Date.now(), this.catalog.status().checkedAt)
          || !notificationCandidate(JSON.parse(sub.profile), JSON.parse(sub.need), fresh, Date.now())) {
          db.prepare("UPDATE notifications SET delivery_state='cancelled' WHERE id=?").run(notification.id); continue;
        }
        // Recheck consent after the source request, before the external side effect.
        const consent = this.store.get(sub.user_id);
        if (!consent?.external_delivery || consent.context_hash !== notification.context_hash) continue;
        // Persist the claim before sending. A process crash or ambiguous timeout
        // must not automatically deliver the same message twice.
        const claimed = db.prepare("UPDATE notifications SET delivery_state='sending' WHERE id=? AND delivery_state='pending'").run(notification.id);
        if (!claimed.changes) continue;
        await this.transport.send({ user: sub.user_id, programId: notification.program_id, title: notification.title,
          text: `Нашли меру поддержки для вашего бизнеса\n\n${notification.title}\n\n${notification.reason}\n\nAI отметил связь с вашим бизнесом. Полные условия и решение — у оператора программы.\nИсточник: ${notification.source}` });
        db.prepare("UPDATE notifications SET delivery_state='sent' WHERE id=?").run(notification.id); deliveredUsers.add(sub.user_id);
      } catch (error) {
        const rejected = error instanceof DeliveryRejected;
        const delivery = db.prepare('SELECT delivery_state FROM notifications WHERE id=?').get(notification.id) as { delivery_state: string } | undefined;
        const ambiguous = delivery?.delivery_state === 'sending' && !rejected;
        db.prepare('UPDATE notifications SET delivery_state=?,attempts=attempts+1,next_at=? WHERE id=?').run(ambiguous ? 'unconfirmed' : rejected && error.permanent || notification.attempts >= 7 ? 'failed' : 'pending', now + Math.min(86400000, 60000 * 2 ** notification.attempts), notification.id);
        failures++;
      }
    }
    return failures;
  }
}
