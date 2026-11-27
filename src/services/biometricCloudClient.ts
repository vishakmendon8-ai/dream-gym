/**
 * Client for the dedicated Google Cloud Run Secureye Biometric WebSocket Backend
 * (`biometric-ws-server/`).
 */

export interface BiometricConnectionError {
  timestamp: string;
  message: string;
}

export interface BiometricLastAttendance {
  attendanceId: string;
  biometricUserId: string;
  memberId: string;
  memberName: string;
  timestamp: string;
  verificationMethod: string;
  status: 'granted' | 'denied';
  reason: string;
}

export interface CloudBiometricDeviceState {
  id: string;
  brand: string;
  serialNumber: string;
  cloudId: string;
  deviceUniqueId: string | null;
  localIp: string | null;
  subnetMask?: string;
  gateway?: string;
  p2pServerIp?: string;
  p2pServerPort?: number;
  tcpPort?: number;
  communicationPassword?: boolean;
  serverClientMode: string;
  p2pLinkStatus?: string;
  registrationStatus: string;
  wsConnectionStatus: 'connected' | 'disconnected';
  protocolStatus: string;
  remoteIp: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastReceivedMessage: string | null;
  lastReceivedMessageType: string | null;
  lastReceivedMessageAt: string | null;
  lastAttendanceEvent: BiometricLastAttendance | null;
  totalAttendanceEvents: number;
  connectionErrors: BiometricConnectionError[];
  updatedAt: string;
}

export interface BiometricDiagnosticLog {
  id: string;
  timestamp: string;
  event: string;
  connectionId?: string;
  deviceId?: string | null;
  remoteIp?: string;
  path?: string;
  messageType: string;
  category?: string;
  command?: string | null;
  keys?: string[] | null;
  byteLength?: number;
  protocolRecognized?: boolean;
  needsOfficialDocs?: boolean;
  headers?: Record<string, string>;
  rawText?: string | null;
  hexPreview?: string | null;
  asciiPreview?: string | null;
  base64Preview?: string | null;
  rawPreview: string;
}

export interface BiometricCloudAttendanceRecord {
  id: string;
  memberId: string;
  memberName: string;
  timestamp: string;
  verifyMode?: string;
  verificationResult?: string;
  status: 'granted' | 'denied';
  reason?: string;
  deviceSn?: string;
  biometricUserId?: string;
  eventId?: string | null;
  rawPunchTime?: string;
}

export interface BiometricStatusResponse {
  ok: boolean;
  cloudRun?: boolean;
  firebaseProjectId?: string;
  firestoreConnected?: boolean;
  firestoreAuthMode?: string;
  device?: CloudBiometricDeviceState;
  devices?: CloudBiometricDeviceState[];
  serverTime?: string;
  error?: string;
}

function cleanBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function buildHeaders(apiSecret?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiSecret && apiSecret.trim()) {
    h.Authorization = `Bearer ${apiSecret.trim()}`;
  }
  return h;
}

export function buildBiometricWssUrl(baseUrl: string): string | null {
  try {
    const u = new URL(cleanBase(baseUrl));
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}/biometric`;
  } catch {
    return null;
  }
}

export function buildAdminWsUrl(baseUrl: string, apiSecret?: string): string | null {
  try {
    const u = new URL(cleanBase(baseUrl));
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = apiSecret && apiSecret.trim() ? `?token=${encodeURIComponent(apiSecret.trim())}` : '';
    return `${proto}//${u.host}/ws/admin${qs}`;
  } catch {
    return null;
  }
}

export async function fetchBiometricStatus(
  baseUrl: string,
  apiSecret?: string
): Promise<BiometricStatusResponse> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/status`, {
      headers: buildHeaders(apiSecret),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }
    return data as BiometricStatusResponse;
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Unable to reach Cloud Run WebSocket backend.',
    };
  }
}

export async function testBiometricConnection(
  baseUrl: string,
  apiSecret?: string
): Promise<{
  ok: boolean;
  serverReachable?: boolean;
  websocketHandshakeOk?: boolean;
  deviceConnected?: boolean;
  firestoreConnected?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/test-connection`, {
      method: 'POST',
      headers: buildHeaders(apiSecret),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }

    // Also verify real browser WebSocket handshake on /biometric
    const wssUrl = buildBiometricWssUrl(baseUrl);
    let wsOk = false;
    if (wssUrl && typeof WebSocket !== 'undefined') {
      wsOk = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(wssUrl);
        const t = setTimeout(() => {
          try { ws.close(); } catch {}
          resolve(false);
        }, 6000);
        ws.onopen = () => {
          clearTimeout(t);
          ws.close(1000, 'Admin handshake test');
          resolve(true);
        };
        ws.onerror = () => {
          clearTimeout(t);
          resolve(false);
        };
      });
    }

    return {
      ok: true,
      serverReachable: data.serverReachable,
      websocketHandshakeOk: wsOk,
      deviceConnected: data.deviceConnected,
      firestoreConnected: data.firestoreConnected,
      message: `${data.message} ${
        wsOk
          ? 'Live WebSocket handshake on /biometric verified (HTTP 101).'
          : 'WebSocket handshake probe on /biometric did not open.'
      }`,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Connection test failed.' };
  }
}

export async function fetchBiometricDiagnostics(
  baseUrl: string,
  apiSecret?: string,
  limit = 60
): Promise<{ ok: boolean; logs: BiometricDiagnosticLog[]; error?: string }> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/diagnostics?limit=${limit}`, {
      headers: buildHeaders(apiSecret),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, logs: [], error: data.error || `HTTP ${resp.status}` };
    }
    return { ok: true, logs: data.logs || [] };
  } catch (err: any) {
    return { ok: false, logs: [], error: err?.message || 'Failed to load diagnostic logs.' };
  }
}

export async function fetchBiometricAttendance(
  baseUrl: string,
  apiSecret?: string,
  limit = 100
): Promise<{ ok: boolean; records: BiometricCloudAttendanceRecord[]; error?: string }> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/attendance?limit=${limit}`, {
      headers: buildHeaders(apiSecret),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, records: [], error: data.error || `HTTP ${resp.status}` };
    }
    return { ok: true, records: data.records || [] };
  } catch (err: any) {
    return { ok: false, records: [], error: err?.message || 'Failed to load attendance logs.' };
  }
}

export async function syncBiometricAttendance(
  baseUrl: string,
  deviceId = '102026020002110',
  apiSecret?: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/sync`, {
      method: 'POST',
      headers: buildHeaders(apiSecret),
      body: JSON.stringify({ deviceId }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }
    return { ok: true, message: data.message };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Attendance sync request failed.' };
  }
}

export async function disconnectBiometricDevice(
  baseUrl: string,
  deviceId = '102026020002110',
  apiSecret?: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/disconnect`, {
      method: 'POST',
      headers: buildHeaders(apiSecret),
      body: JSON.stringify({ deviceId }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }
    return { ok: true, message: data.message };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Disconnect request failed.' };
  }
}

export async function syncMembersToBiometricBackend(
  baseUrl: string,
  members: Array<{
    id: string;
    name: string;
    email?: string;
    avatar?: string;
    biometricId?: string;
    status: string;
    planName?: string;
    startDate?: string;
    joinDate?: string;
    expiryDate?: string;
  }>,
  apiSecret?: string
): Promise<{
  ok: boolean;
  message?: string;
  enabledCount?: number;
  blockedCount?: number;
  error?: string;
}> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/members-sync`, {
      method: 'POST',
      headers: buildHeaders(apiSecret),
      body: JSON.stringify({ members }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }
    return {
      ok: true,
      message: data.enforcement?.message,
      enabledCount: data.enforcement?.enabledCount,
      blockedCount: data.enforcement?.blockedCount,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Member subscription sync failed.' };
  }
}

export async function enforceSubscriptionsOnDevice(
  baseUrl: string,
  deviceId = '102026020002110',
  apiSecret?: string
): Promise<{
  ok: boolean;
  message?: string;
  enabledCount?: number;
  blockedCount?: number;
  deviceConnected?: boolean;
  error?: string;
}> {
  try {
    const resp = await fetch(`${cleanBase(baseUrl)}/api/biometric/enforce-subscriptions`, {
      method: 'POST',
      headers: buildHeaders(apiSecret),
      body: JSON.stringify({ deviceId }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }
    return data;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Subscription enforcement failed.' };
  }
}
