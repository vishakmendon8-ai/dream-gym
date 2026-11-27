/**
 * Real Web Push (VAPID / RFC 8291) Service for Dream Gym Member App.
 *
 * Sends high-priority push notifications with 24-hour TTL directly through
 * browser push services (Google FCM / Apple APNs / Mozilla Push), so alerts
 * deliver even when the Member App tab is closed, the phone screen is locked,
 * or the phone temporarily loses power/signal (queued until device boots back on).
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const webpush = require('web-push');

const VAPID_CACHE_FILE = path.resolve(process.env.VAPID_KEYS_PATH || '/tmp/dreamgym-vapid-keys.json');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@dreamgym.fitness';

export class MemberPushService {
  constructor(store) {
    this.store = store;
    this.vapidKeys = null;
    // Map<endpoint, { memberId, memberName, biometricId, subscription, updatedAt }>
    this.subscriptions = new Map();
    // Deduplicate daily expiry alerts per memberId:date
    this.dailyExpiryNotified = new Set();
  }

  async init() {
    const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();

    if (envPub && envPriv) {
      this.vapidKeys = { publicKey: envPub, privateKey: envPriv };
    } else if (this.store?.firestoreReady) {
      try {
        const docRef = this.store.firestore.collection('settings').doc('web_push_vapid');
        const snap = await docRef.get();
        if (snap.exists && snap.data()?.publicKey && snap.data()?.privateKey) {
          this.vapidKeys = {
            publicKey: snap.data().publicKey,
            privateKey: snap.data().privateKey,
          };
        } else {
          this.vapidKeys = webpush.generateVAPIDKeys();
          await docRef.set({
            ...this.vapidKeys,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {
        this.vapidKeys = this.loadOrGenerateLocalKeys();
      }
    } else {
      this.vapidKeys = this.loadOrGenerateLocalKeys();
    }

    webpush.setVapidDetails(
      VAPID_SUBJECT,
      this.vapidKeys.publicKey,
      this.vapidKeys.privateKey
    );

    await this.hydrateSubscriptionsFromFirestore();
    console.log('[WebPush] VAPID push service ready.');
  }

  loadOrGenerateLocalKeys() {
    try {
      if (fs.existsSync(VAPID_CACHE_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(VAPID_CACHE_FILE, 'utf8'));
        if (parsed?.publicKey && parsed?.privateKey) return parsed;
      }
    } catch {}
    const fresh = webpush.generateVAPIDKeys();
    try {
      fs.writeFileSync(VAPID_CACHE_FILE, JSON.stringify(fresh), 'utf8');
    } catch {}
    return fresh;
  }

  async hydrateSubscriptionsFromFirestore() {
    if (!this.store?.firestoreReady) return;
    try {
      const snap = await this.store.firestore.collection('member_push_subscriptions').get();
      for (const doc of snap.docs) {
        const d = doc.data();
        if (d?.subscription?.endpoint) {
          this.subscriptions.set(d.subscription.endpoint, d);
        }
      }
    } catch {}
  }

  getPublicKey() {
    return this.vapidKeys?.publicKey || null;
  }

  async saveSubscription({ memberId, memberName, biometricId, subscription }) {
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return { ok: false, error: 'Invalid PushSubscription payload.' };
    }

    const record = {
      memberId: String(memberId || 'anonymous').trim(),
      memberName: String(memberName || 'Member').trim(),
      biometricId: String(biometricId || '').trim(),
      subscription: {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    this.subscriptions.set(subscription.endpoint, record);

    if (this.store?.firestoreReady) {
      try {
        const docId = Buffer.from(subscription.endpoint).toString('base64url').slice(0, 120);
        await this.store.firestore
          .collection('member_push_subscriptions')
          .doc(docId)
          .set(record, { merge: true });
      } catch {}
    }

    return { ok: true, subscribedCount: this.subscriptions.size };
  }

  async removeEndpoint(endpoint) {
    this.subscriptions.delete(endpoint);
    if (this.store?.firestoreReady) {
      try {
        const docId = Buffer.from(endpoint).toString('base64url').slice(0, 120);
        await this.store.firestore.collection('member_push_subscriptions').doc(docId).delete();
      } catch {}
    }
  }

  /**
   * Send a real high-priority Web Push with 24h TTL to a specific memberId / biometricId
   * or broadcast to all subscribed members when targetMemberId === 'all'.
   */
  async sendPush({ targetMemberId = 'all', biometricId = null, title, body, url = '/member', tag = 'dreamgym-alert' }) {
    if (!this.vapidKeys) return { ok: false, sent: 0, error: 'VAPID not initialized' };

    const targets = [];
    const targetIdNorm = String(targetMemberId || '').trim().toLowerCase();
    const bioNorm = biometricId ? String(biometricId).trim().toLowerCase() : null;

    for (const rec of this.subscriptions.values()) {
      const matchesAll = targetIdNorm === 'all' || targetIdNorm === '*';
      const matchesMember = rec.memberId.toLowerCase() === targetIdNorm;
      const matchesBio = bioNorm && rec.biometricId && rec.biometricId.toLowerCase() === bioNorm;
      if (matchesAll || matchesMember || matchesBio) {
        targets.push(rec);
      }
    }

    if (targets.length === 0) {
      return { ok: true, sent: 0, totalTargets: 0 };
    }

    const payload = JSON.stringify({
      title: title || 'Dream Gym',
      body: body || 'You have a new gym notification.',
      url,
      tag,
      timestamp: Date.now(),
    });

    let sent = 0;
    let failed = 0;

    await Promise.all(
      targets.map(async (rec) => {
        try {
          await webpush.sendNotification(rec.subscription, payload, {
            TTL: 86400, // 24-hour cloud queue if phone is off/offline
            urgency: 'high',
          });
          sent += 1;
        } catch (err) {
          failed += 1;
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await this.removeEndpoint(rec.subscription.endpoint);
          }
        }
      })
    );

    return { ok: true, sent, failed, totalTargets: targets.length };
  }

  /**
   * Automatically notify subscribed members whose plans expire within <= 3 days or just expired.
   */
  async notifyExpiringMembers(members = []) {
    const todayKey = new Date().toISOString().split('T')[0];
    const now = Date.now();

    for (const m of members) {
      if (!m?.id || !m?.expiryDate) continue;
      const exp = new Date(m.expiryDate);
      if (Number.isNaN(exp.getTime())) continue;
      exp.setHours(23, 59, 59, 999);

      const daysDiff = Math.ceil((exp.getTime() - now) / 86_400_000);
      if (daysDiff > 3 || daysDiff < -1) continue;

      const dedupKey = `${m.id}:${todayKey}`;
      if (this.dailyExpiryNotified.has(dedupKey)) continue;
      this.dailyExpiryNotified.add(dedupKey);

      const title =
        daysDiff <= 0
          ? 'Dream Gym: Membership Expired'
          : `Dream Gym: ${daysDiff} Day${daysDiff === 1 ? '' : 's'} Left`;
      const body =
        daysDiff <= 0
          ? `Hi ${m.name}, your ${m.planName || 'gym'} membership has expired. Renew to restore entry.`
          : `Hi ${m.name}, your ${m.planName || 'gym'} membership expires on ${m.expiryDate}.`;

      await this.sendPush({
        targetMemberId: m.id,
        biometricId: m.biometricId,
        title,
        body,
        url: '/member?screen=membership-details',
        tag: `dreamgym-expiry-${m.id}`,
      });
    }
  }
}
