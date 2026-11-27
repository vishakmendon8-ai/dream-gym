/**
 * Firebase Admin SDK & Cloud Firestore Store for Secureye WebSocket Backend.
 *
 * Uses existing Firebase project (gym001-50a97) via:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON (Google Secret Manager)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH
 *   3. Cloud Run Application Default Credentials (K_SERVICE)
 *
 * Maintains an in-memory mirror as well so diagnostics & device status remain fast
 * and testable locally even without GCP credentials.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { config } from './config.js';

function parseExpiryDate(rawDate) {
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(23, 59, 59, 999);
  return parsed;
}

export function evaluateSubscription(memberData, punchDate = new Date()) {
  if (!memberData) {
    return { granted: false, reason: 'Biometric User ID is not linked to any Gym Member.' };
  }
  if (memberData.status === 'inactive') {
    return { granted: false, reason: 'Membership account is inactive / suspended.' };
  }
  if (memberData.status === 'expired') {
    return {
      granted: false,
      reason: `Membership expired${memberData.expiryDate ? ` on ${memberData.expiryDate}` : ''}.`,
    };
  }
  const expiry = parseExpiryDate(memberData.expiryDate);
  if (expiry && expiry.getTime() < punchDate.getTime()) {
    return { granted: false, reason: `Membership expired on ${memberData.expiryDate}.` };
  }
  if (memberData.status === 'pending') {
    return { granted: false, reason: 'Membership payment pending activation.' };
  }
  return { granted: true, reason: 'Active gym subscription verified via Secureye WebSocket scan.' };
}

export class BiometricFirebaseStore {
  constructor() {
    this.firestore = null;
    this.firestoreReady = false;
    this.authMode = 'memory_only';

    // In-memory ring buffers & state cache
    this.devices = new Map();
    this.diagnostics = [];
    this.attendanceCache = [];
    this.dedupKeys = new Set();
    // Synced Dream Gym members keyed by member.id (used for real-time expiry checks & hardware blocking)
    this.memberDirectory = new Map();

    // Seed baseline verified Secureye device metadata (strictly disconnected until real WS connects)
    const d = config.defaultDevice;
    this.devices.set(d.serialNumber, {
      id: d.serialNumber,
      brand: d.brand,
      serialNumber: d.serialNumber,
      cloudId: d.cloudId,
      deviceUniqueId: d.deviceUniqueId,
      localIp: d.localIp,
      subnetMask: d.subnetMask,
      gateway: d.gateway,
      p2pServerIp: d.p2pServerIp,
      p2pServerPort: d.p2pServerPort,
      tcpPort: d.tcpPort,
      communicationPassword: d.communicationPassword,
      serverClientMode: d.serverClientMode,
      p2pLinkStatus: d.p2pLinkStatus,
      registrationStatus: 'awaiting_device_connection',
      wsConnectionStatus: 'disconnected',
      protocolStatus: 'awaiting_device_traffic',
      remoteIp: null,
      connectedAt: null,
      disconnectedAt: null,
      lastHeartbeatAt: null,
      lastReceivedMessage: null,
      lastReceivedMessageType: null,
      lastReceivedMessageAt: null,
      lastAttendanceEvent: null,
      totalAttendanceEvents: 0,
      connectionErrors: [],
      updatedAt: new Date().toISOString(),
    });
  }

  async init() {
    const inlineJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    const keyPath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();

    try {
      let serviceAccount = null;
      if (inlineJson) {
        serviceAccount = JSON.parse(
          inlineJson.startsWith('{')
            ? inlineJson
            : Buffer.from(inlineJson, 'base64').toString('utf8')
        );
      } else if (keyPath && fs.existsSync(path.resolve(keyPath))) {
        serviceAccount = JSON.parse(fs.readFileSync(path.resolve(keyPath), 'utf8'));
      }

      if (serviceAccount) {
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: config.firebaseProjectId,
          });
        }
        this.firestore = admin.firestore();
        this.firestoreReady = true;
        this.authMode = 'service_account';
      } else if (config.isCloudRun || process.env.USE_GCP_ADC === 'true') {
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: config.firebaseProjectId,
          });
        }
        this.firestore = admin.firestore();
        this.firestoreReady = true;
        this.authMode = 'cloud_run_adc';
      } else {
        console.log(
          '[FirebaseStore] Running in local memory mode (no GCP credentials found; Cloud Run ADC activates automatically when deployed).'
        );
        return;
      }

      // Hydrate or persist baseline Secureye device document without overwriting live counters
      const defSn = config.defaultDevice.serialNumber;
      const docRef = this.firestore.collection('biometric_devices').doc(defSn);
      const snap = await docRef.get();
      if (snap.exists) {
        const existing = snap.data();
        const merged = {
          ...this.devices.get(defSn),
          ...existing,
          // Reset live WS connection status on cold container boot until device reconnects
          wsConnectionStatus: 'disconnected',
          updatedAt: new Date().toISOString(),
        };
        this.devices.set(defSn, merged);
        await docRef.set(merged, { merge: true });
      } else {
        await docRef.set(this.devices.get(defSn), { merge: true });
      }

      console.log(
        `[FirebaseStore] Connected to Firestore project "${config.firebaseProjectId}" via ${this.authMode}.`
      );
    } catch (err) {
      console.error('[FirebaseStore] Firestore init error:', err.message);
      this.firestoreReady = false;
      this.authMode = 'error_fallback';
    }
  }

  getDevice(deviceId = config.defaultDevice.serialNumber) {
    const id = String(deviceId || config.defaultDevice.serialNumber).trim();
    if (!this.devices.has(id)) {
      this.devices.set(id, {
        id,
        brand: 'Secureye',
        serialNumber: id,
        cloudId: id,
        deviceUniqueId: null,
        localIp: null,
        serverClientMode: 'WebSocket',
        registrationStatus: 'awaiting_device_connection',
        wsConnectionStatus: 'disconnected',
        protocolStatus: 'awaiting_device_traffic',
        remoteIp: null,
        connectedAt: null,
        disconnectedAt: null,
        lastHeartbeatAt: null,
        lastReceivedMessage: null,
        lastReceivedMessageType: null,
        lastReceivedMessageAt: null,
        lastAttendanceEvent: null,
        totalAttendanceEvents: 0,
        connectionErrors: [],
        updatedAt: new Date().toISOString(),
      });
    }
    return this.devices.get(id);
  }

  listDevices() {
    return Array.from(this.devices.values());
  }

  async updateDeviceState(deviceId, patch) {
    const current = this.getDevice(deviceId);
    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.devices.set(updated.id, updated);

    if (this.firestoreReady) {
      try {
        await this.firestore
          .collection('biometric_devices')
          .doc(updated.id)
          .set(updated, { merge: true });
      } catch (err) {
        console.error('[FirebaseStore] Failed to persist device state:', err.message);
      }
    }
    return updated;
  }

  async recordConnectionError(deviceId, errorMessage) {
    const current = this.getDevice(deviceId);
    const entry = {
      timestamp: new Date().toISOString(),
      message: String(errorMessage),
    };
    const nextErrors = [entry, ...(current.connectionErrors || [])].slice(0, 20);
    return this.updateDeviceState(deviceId, { connectionErrors: nextErrors });
  }

  async logDiagnostic(entry) {
    const record = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.diagnostics.unshift(record);
    if (this.diagnostics.length > 200) {
      this.diagnostics.length = 200;
    }

    if (this.firestoreReady) {
      try {
        await this.firestore.collection('biometric_raw_diagnostics').doc(record.id).set({
          ...record,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error('[FirebaseStore] Failed to persist diagnostic log:', err.message);
      }
    }

    return record;
  }

  async listDiagnostics(limitCount = 50) {
    const max = Math.min(Math.max(Number(limitCount) || 50, 1), 200);
    if (this.firestoreReady && this.diagnostics.length === 0) {
      try {
        const snap = await this.firestore
          .collection('biometric_raw_diagnostics')
          .orderBy('createdAt', 'desc')
          .limit(max)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch {
        // Fallback to cache
      }
    }
    return this.diagnostics.slice(0, max);
  }

  async listAttendance(limitCount = 100) {
    const max = Math.min(Math.max(Number(limitCount) || 100, 1), 200);
    if (this.firestoreReady) {
      try {
        const snap = await this.firestore
          .collection('attendance')
          .where('source', '==', 'secureye_websocket')
          .orderBy('createdAt', 'desc')
          .limit(max)
          .get();
        if (!snap.empty) {
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
      } catch {
        // Fallback if composite index not yet created
        try {
          const snap = await this.firestore
            .collection('attendance')
            .orderBy('createdAt', 'desc')
            .limit(max)
            .get();
          if (!snap.empty) {
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          }
        } catch {}
      }
    }
    return this.attendanceCache.slice(0, max);
  }

  /**
   * Sync gym members & subscription dates from Dream Gym (or Firestore) so the
   * WebSocket server can decline expired members in real time AND push block/enable
   * commands to the physical Secureye machine.
   */
  syncMembersDirectory(membersList = []) {
    if (!Array.isArray(membersList)) return { total: 0, active: 0, expired: 0 };
    const next = new Map();
    const now = new Date();
    let activeCount = 0;
    let expiredCount = 0;

    for (const raw of membersList) {
      if (!raw || !raw.id) continue;
      const entry = {
        id: String(raw.id).trim(),
        name: String(raw.name || 'Member').trim(),
        email: raw.email || null,
        avatar: raw.avatar || null,
        biometricId: String(raw.biometricId || '').trim(),
        status: String(raw.status || 'pending').trim().toLowerCase(),
        planName: String(raw.planName || '').trim(),
        startDate: raw.startDate || raw.joinDate || null,
        expiryDate: raw.expiryDate || null,
      };
      next.set(entry.id, entry);
      const verdict = evaluateSubscription(entry, now);
      if (verdict.granted) activeCount += 1;
      else expiredCount += 1;
    }

    this.memberDirectory = next;
    return { total: next.size, active: activeCount, expired: expiredCount };
  }

  async getAllMembers() {
    if (this.firestoreReady) {
      try {
        const snap = await this.firestore.collection('members').get();
        if (!snap.empty) {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          this.syncMembersDirectory(list);
          return list;
        }
      } catch {}
    }
    return Array.from(this.memberDirectory.values());
  }

  lookupMemberInDirectory(biometricUserId) {
    const clean = String(biometricUserId || '').trim().toLowerCase();
    if (!clean) return null;
    for (const m of this.memberDirectory.values()) {
      if (
        (m.biometricId && m.biometricId.trim().toLowerCase() === clean) ||
        m.id.trim().toLowerCase() === clean
      ) {
        return m;
      }
    }
    return null;
  }

  /**
   * Process a real extracted attendance event:
   *  - Deduplicate deterministically (deviceId + biometricUserId + second-level timestamp + eventId)
   *  - Map biometricUserId -> Gym Member ID in Firestore `members` (or synced memberDirectory)
   *  - Validate member subscription status & expiry date
   *  - Persist to `attendance`, `access_logs`, `biometric_sync_logs`, and update device stats
   */
  async processAttendanceEvent(evt) {
    const deviceId = String(evt.deviceId || config.defaultDevice.serialNumber).trim();
    const biometricUserId = String(evt.biometricUserId || '').trim();
    const punchIso = evt.attendanceTimestamp || new Date().toISOString();
    const punchDate = new Date(punchIso);

    if (!biometricUserId) {
      return { ok: false, error: 'Missing biometricUserId' };
    }

    const dedupSeed = `${deviceId.toUpperCase()}|${biometricUserId}|${punchIso.slice(0, 19)}|${evt.eventId || ''}`;
    const eventKey = crypto.createHash('sha256').update(dedupSeed).digest('hex');

    // 1. Atomic duplicate protection
    if (this.dedupKeys.has(eventKey)) {
      // Still evaluate subscription verdict so the machine gets the right access: 0/1 reply!
      const cachedMember = this.lookupMemberInDirectory(biometricUserId);
      const cachedVerdict = evaluateSubscription(cachedMember, punchDate);
      return { ok: true, duplicate: true, eventKey, granted: cachedVerdict.granted, reason: cachedVerdict.reason };
    }

    if (this.firestoreReady) {
      const dedupRef = this.firestore.collection('biometric_event_dedup').doc(eventKey);
      const alreadyExists = await this.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(dedupRef);
        if (snap.exists) return true;
        tx.set(dedupRef, {
          deviceId,
          biometricUserId,
          punchTime: punchIso,
          eventId: evt.eventId || null,
          receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return false;
      });
      if (alreadyExists) {
        this.dedupKeys.add(eventKey);
        const cachedMember = this.lookupMemberInDirectory(biometricUserId);
        const cachedVerdict = evaluateSubscription(cachedMember, punchDate);
        return { ok: true, duplicate: true, eventKey, granted: cachedVerdict.granted, reason: cachedVerdict.reason };
      }
    }
    this.dedupKeys.add(eventKey);

    // 2. Lookup Gym Member by biometricId (Firestore first, then synced Dream Gym directory)
    let memberDoc = null;
    let memberData = null;

    if (this.firestoreReady) {
      const membersRef = this.firestore.collection('members');
      const byBio = await membersRef.where('biometricId', '==', biometricUserId).limit(1).get();
      if (!byBio.empty) {
        memberDoc = byBio.docs[0];
        memberData = memberDoc.data();
      } else {
        const direct = await membersRef.doc(biometricUserId).get();
        if (direct.exists) {
          memberDoc = direct;
          memberData = direct.data();
        }
      }
    }

    if (!memberData) {
      const dirMatch = this.lookupMemberInDirectory(biometricUserId);
      if (dirMatch) {
        memberData = dirMatch;
      }
    }

    const verdict =
      evt.verificationResult === 'failed'
        ? { granted: false, reason: 'Biometric verification failed on Secureye terminal.' }
        : evaluateSubscription(memberData, punchDate);

    const checkInDate = punchIso.split('T')[0];
    const checkInTime = punchDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const attendanceId = `att-${eventKey.slice(0, 16)}`;
    const accessLogId = `log-${eventKey.slice(0, 16)}`;
    const terminalId = `Secureye WS (${deviceId})`;
    const resolvedMemberId = memberDoc ? memberDoc.id : memberData ? memberData.id : `UNLINKED:${biometricUserId}`;

    const attendanceRecord = {
      id: attendanceId,
      memberId: resolvedMemberId,
      memberName: memberData ? memberData.name : `Unlinked User (${biometricUserId})`,
      memberEmail: memberData?.email || null,
      avatar:
        memberData?.avatar ||
        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
      checkInDate,
      checkInTime,
      timestamp: `${checkInDate} ${checkInTime}`,
      method: 'biometric',
      verifyMode: evt.verificationMethod || 'Fingerprint',
      verificationResult: evt.verificationResult || 'verified',
      status: verdict.granted ? 'granted' : 'denied',
      reason: verdict.reason,
      terminalId,
      deviceSn: deviceId,
      biometricUserId,
      eventId: evt.eventId || null,
      eventKey,
      source: 'secureye_websocket',
      rawPunchTime: punchIso,
    };

    const accessLogRecord = {
      id: accessLogId,
      memberId: attendanceRecord.memberId,
      memberName: attendanceRecord.memberName,
      avatar: attendanceRecord.avatar,
      time: checkInTime,
      status: attendanceRecord.status,
      reason: verdict.reason,
      terminalId,
      deviceSn: deviceId,
      biometricUserId,
      source: 'secureye_websocket',
    };

    this.attendanceCache.unshift(attendanceRecord);
    if (this.attendanceCache.length > 200) this.attendanceCache.length = 200;

    if (this.firestoreReady) {
      const batch = this.firestore.batch();
      batch.set(this.firestore.collection('attendance').doc(attendanceId), {
        ...attendanceRecord,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batch.set(this.firestore.collection('access_logs').doc(accessLogId), {
        ...accessLogRecord,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (memberDoc && verdict.granted) {
        batch.update(memberDoc.ref, {
          totalCheckIns: admin.firestore.FieldValue.increment(1),
          lastCheckIn: `${checkInDate} ${checkInTime}`,
          lastVisit: `${checkInDate} ${checkInTime}`,
        });
      }

      await batch.commit();

      await this.firestore.collection('biometric_sync_logs').add({
        timestamp: new Date().toISOString(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        level: verdict.granted ? 'success' : 'warning',
        eventType: 'ws_attendance',
        deviceSn: deviceId,
        biometricUserId,
        memberId: memberDoc?.id || null,
        message: verdict.granted
          ? `Secureye WS punch recorded for ${attendanceRecord.memberName} (${attendanceRecord.memberId})`
          : `Secureye WS punch denied for User ${biometricUserId}: ${verdict.reason}`,
        details: `attendanceId=${attendanceId}, method=${attendanceRecord.verifyMode}`,
      });
    }

    const currentDev = this.getDevice(deviceId);
    await this.updateDeviceState(deviceId, {
      lastAttendanceEvent: {
        attendanceId,
        biometricUserId,
        memberId: attendanceRecord.memberId,
        memberName: attendanceRecord.memberName,
        timestamp: punchIso,
        verificationMethod: attendanceRecord.verifyMode,
        status: attendanceRecord.status,
        reason: attendanceRecord.reason,
      },
      totalAttendanceEvents: (currentDev.totalAttendanceEvents || 0) + 1,
    });

    return {
      ok: true,
      duplicate: false,
      record: attendanceRecord,
      granted: verdict.granted,
    };
  }
}
