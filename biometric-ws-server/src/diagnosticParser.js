/**
 * Diagnostic Receiver & Protocol Inspector for Secureye WebSocket Biometric Messages.
 *
 * Strictly records incoming binary, JSON, and plain-text WebSocket frames without
 * inventing proprietary formats. Extracts attendance fields only when verified
 * standard fields are present; otherwise marks the frame as unrecognized so the
 * raw payload can be inspected in Firestore / Admin Diagnostics.
 */

import { config } from './config.js';

const VERIFY_MODE_MAP = {
  '0': 'Password',
  '1': 'Fingerprint',
  '2': 'Card',
  '3': 'Password',
  '4': 'Card',
  '15': 'Face',
  '25': 'Palm',
  fingerprint: 'Fingerprint',
  fp: 'Fingerprint',
  face: 'Face',
  card: 'Card',
  rfid: 'Card',
  password: 'Password',
  pin: 'Password',
  palm: 'Palm',
};

export function mapVerificationMethod(rawMode) {
  if (rawMode === undefined || rawMode === null || rawMode === '') return 'Unknown';
  const key = String(rawMode).trim().toLowerCase();
  return VERIFY_MODE_MAP[key] || `Mode(${rawMode})`;
}

export function formatDeviceCloudTime(tzOffsetHours = config.timezoneOffsetHours) {
  const offsetMs = (Number.isFinite(tzOffsetHours) ? tzOffsetHours : 0) * 3600_000;
  const local = new Date(Date.now() + offsetMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}

export function normalizeDeviceTimestamp(rawTs, tzOffsetHours = config.timezoneOffsetHours) {
  const trimmed = String(rawTs ?? '').trim();
  if (!trimmed) return null;

  // Epoch milliseconds or seconds
  if (/^\d{10,13}$/.test(trimmed)) {
    const ms = trimmed.length === 10 ? Number(trimmed) * 1000 : Number(trimmed);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Already has timezone suffix
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Device local format: YYYY-MM-DD HH:mm:ss or YYYY/MM/DD HH:mm:ss
  const m = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, y, mo, da, h, mi, s] = m;
    const totalMin = Math.round((Number.isFinite(tzOffsetHours) ? tzOffsetHours : 0) * 60);
    const sign = totalMin >= 0 ? '+' : '-';
    const abs = Math.abs(totalMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    const d = new Date(`${y}-${mo}-${da}T${h}:${mi}:${s}${sign}${hh}:${mm}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Inspect any incoming WebSocket frame (binary, JSON, or text) and classify it.
 */
export function inspectIncomingFrame(rawData, isBinary) {
  const buffer = Buffer.isBuffer(rawData)
    ? rawData
    : Array.isArray(rawData)
    ? Buffer.concat(rawData)
    : Buffer.from(rawData);

  const byteLength = buffer.length;

  // 1. Binary Frame
  if (isBinary) {
    const hexPreview = buffer.subarray(0, 512).toString('hex');
    const asciiPreview = buffer
      .subarray(0, 512)
      .toString('utf8')
      .replace(/[^\x20-\x7E\r\n\t]/g, '.');
    const base64Preview = buffer.subarray(0, 1024).toString('base64');

    // Check if the device accidentally sent UTF-8 JSON inside a binary WS frame
    const trimmedUtf8 = buffer.toString('utf8').replace(/\0/g, '').trim();
    if (trimmedUtf8.startsWith('{') && trimmedUtf8.endsWith('}')) {
      try {
        const parsedJson = JSON.parse(trimmedUtf8);
        return analyzeJsonPayload(parsedJson, trimmedUtf8, {
          frameKind: 'binary_containing_json',
          byteLength,
          hexPreview,
        });
      } catch {
        // Pure binary payload
      }
    }

    return {
      messageType: 'binary',
      category: 'binary_unrecognized',
      protocolRecognized: false,
      needsOfficialDocs: true,
      byteLength,
      hexPreview,
      asciiPreview,
      base64Preview,
      rawPreview: `BINARY (${byteLength} bytes) HEX: ${hexPreview.slice(0, 160)}`,
      deviceId: null,
      attendanceEvents: [],
      suggestedReply: null,
    };
  }

  // 2. Text / JSON Frame
  const text = buffer.toString('utf8').replace(/\0/g, '').trim();
  if (!text) {
    return {
      messageType: 'text',
      category: 'empty_frame',
      protocolRecognized: false,
      needsOfficialDocs: false,
      byteLength,
      rawText: '',
      rawPreview: '(empty text frame)',
      deviceId: null,
      attendanceEvents: [],
      suggestedReply: null,
    };
  }

  // Attempt JSON parsing
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return analyzeJsonPayload(parsed, text, {
          frameKind: 'json',
          byteLength,
        });
      }
    } catch {
      // Fall through to plain text diagnostic
    }
  }

  // Plain text diagnostic (non-JSON)
  return {
    messageType: 'text',
    category: 'plain_text_unrecognized',
    protocolRecognized: false,
    needsOfficialDocs: true,
    byteLength,
    rawText: text.slice(0, 4000),
    rawPreview: text.slice(0, 300),
    deviceId: null,
    attendanceEvents: [],
    suggestedReply: null,
  };
}

/**
 * Classify and extract verified fields from a parsed JSON WebSocket message.
 */
function analyzeJsonPayload(obj, rawText, meta) {
  const keys = Object.keys(obj);
  const cmd = String(obj.cmd || obj.command || obj.type || obj.action || '').trim().toLowerCase();
  const ret = String(obj.ret || '').trim().toLowerCase();

  const deviceId =
    String(
      obj.sn ||
        obj.SN ||
        obj.cloudId ||
        obj.cloud_id ||
        obj.deviceId ||
        obj.device_id ||
        obj.devid ||
        ''
    ).trim() || null;

  // A. Device Registration / Handshake (`cmd: "reg"` / `cmd: "register"`)
  if (cmd === 'reg' || cmd === 'register' || cmd === 'login') {
    return {
      messageType: 'json',
      frameKind: meta.frameKind,
      category: 'device_registration',
      command: cmd,
      keys,
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: rawText.slice(0, 4000),
      rawPreview: rawText.slice(0, 300),
      parsedJson: obj,
      deviceId,
      attendanceEvents: [],
      suggestedReply: {
        ret: obj.cmd || 'reg',
        result: true,
        cloudtime: formatDeviceCloudTime(),
        nosenduser: true,
      },
    };
  }

  // B. Heartbeat / Keepalive (`cmd: "heartbeat"` / `cmd: "ping"` / `cmd: "keepalive"`)
  if (cmd === 'heartbeat' || cmd === 'ping' || cmd === 'keepalive' || cmd === 'devstatus') {
    return {
      messageType: 'json',
      frameKind: meta.frameKind,
      category: cmd === 'devstatus' ? 'device_status' : 'heartbeat',
      command: cmd,
      keys,
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: rawText.slice(0, 4000),
      rawPreview: rawText.slice(0, 300),
      parsedJson: obj,
      deviceId,
      attendanceEvents: [],
      suggestedReply: {
        ret: obj.cmd || cmd,
        result: true,
        cloudtime: formatDeviceCloudTime(),
      },
    };
  }

  // C. Attendance Event Push (`cmd: "sendlog"` / `rtlog` / `attlog` / `attendance` or reply to `getnewlog`/`getalllog`)
  const isAttendanceCmd =
    cmd === 'sendlog' ||
    cmd === 'rtlog' ||
    cmd === 'attlog' ||
    cmd === 'attendance' ||
    cmd === 'pushlog' ||
    ret === 'getnewlog' ||
    ret === 'getalllog';

  if (isAttendanceCmd) {
    const rawRecords = Array.isArray(obj.record)
      ? obj.record
      : Array.isArray(obj.records)
      ? obj.records
      : Array.isArray(obj.logs)
      ? obj.logs
      : Array.isArray(obj.data)
      ? obj.data
      : obj.enrollid !== undefined || obj.pin !== undefined || obj.userId !== undefined
      ? [obj]
      : [];

    const attendanceEvents = [];
    for (const rec of rawRecords) {
      if (!rec || typeof rec !== 'object') continue;
      const biometricUserId = String(
        rec.enrollid ?? rec.enroll_id ?? rec.pin ?? rec.userid ?? rec.userId ?? rec.user_id ?? rec.empcode ?? ''
      ).trim();

      if (!biometricUserId) continue;

      const rawTimestamp = rec.time ?? rec.timestamp ?? rec.punch_time ?? rec.datetime ?? rec.checkTime ?? '';
      const attendanceTimestamp = normalizeDeviceTimestamp(rawTimestamp) || new Date().toISOString();
      const verificationMethod = mapVerificationMethod(
        rec.mode ?? rec.verifyMode ?? rec.verifymode ?? rec.verifytype ?? rec.verify_type ?? '1'
      );

      // Verification result if explicitly provided by device
      const rawResult = rec.result ?? rec.verifyResult ?? rec.status_result;
      const verificationResult =
        rawResult === false || String(rawResult).toLowerCase() === 'failed' || String(rawResult) === '0' && rec.result !== undefined
          ? 'failed'
          : 'verified';

      const eventId =
        rec.eventId ?? rec.event_id ?? rec.logindex ?? rec.id ?? obj.logindex ?? null;

      attendanceEvents.push({
        biometricUserId,
        deviceId,
        attendanceTimestamp,
        rawTimestamp: String(rawTimestamp || ''),
        verificationMethod,
        verificationResult,
        inout: String(rec.inout ?? rec.in_out ?? rec.status ?? '0'),
        eventId: eventId !== null && eventId !== undefined ? String(eventId) : null,
        rawRecord: rec,
      });
    }

    return {
      messageType: 'json',
      frameKind: meta.frameKind,
      category: 'attendance_event',
      command: cmd || ret,
      keys,
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: rawText.slice(0, 4000),
      rawPreview: rawText.slice(0, 300),
      parsedJson: obj,
      deviceId,
      attendanceEvents,
      suggestedReply: cmd
        ? {
            ret: obj.cmd,
            result: true,
            count: rawRecords.length,
            ...(obj.logindex !== undefined ? { logindex: obj.logindex } : {}),
            cloudtime: formatDeviceCloudTime(),
            access: 1,
          }
        : null,
    };
  }

  // D. Device User Info Push (`cmd: "senduser"`)
  if (cmd === 'senduser') {
    return {
      messageType: 'json',
      frameKind: meta.frameKind,
      category: 'device_user_sync',
      command: cmd,
      keys,
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: rawText.slice(0, 4000),
      rawPreview: rawText.slice(0, 300),
      parsedJson: obj,
      deviceId,
      attendanceEvents: [],
      suggestedReply: {
        ret: obj.cmd,
        result: true,
        cloudtime: formatDeviceCloudTime(),
      },
    };
  }

  // E. Command reply from device (`ret: "..."`)
  if (ret) {
    return {
      messageType: 'json',
      frameKind: meta.frameKind,
      category: 'device_command_reply',
      command: ret,
      keys,
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: rawText.slice(0, 4000),
      rawPreview: rawText.slice(0, 300),
      parsedJson: obj,
      deviceId,
      attendanceEvents: [],
      suggestedReply: null,
    };
  }

  // F. Unrecognized JSON structure — store raw for protocol discovery!
  return {
    messageType: 'json',
    frameKind: meta.frameKind,
    category: 'unknown_json',
    command: cmd || null,
    keys,
    protocolRecognized: false,
    needsOfficialDocs: true,
    byteLength: meta.byteLength,
    rawText: rawText.slice(0, 4000),
    rawPreview: rawText.slice(0, 300),
    parsedJson: obj,
    deviceId,
    attendanceEvents: [],
    suggestedReply: null,
  };
}
