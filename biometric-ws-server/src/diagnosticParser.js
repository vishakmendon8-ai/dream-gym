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
      // Fall through to plain text / XML diagnostic
    }
  }

  // Attempt Secureye / Realand / F500 XML parsing
  if (text.startsWith('<') || text.includes('<?xml') || text.includes('<Message>') || text.includes('<Response>')) {
    return analyzeXmlPayload(text, {
      frameKind: 'xml',
      byteLength,
    });
  }

  // Plain text diagnostic (non-JSON, non-XML)
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
 * Extract tag value from XML string (case-insensitive).
 */
function extractXmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

/**
 * Classify and extract verified fields from a Secureye / Realand / F500 XML WebSocket message.
 */
function analyzeXmlPayload(xmlText, meta) {
  const request = extractXmlTag(xmlText, 'Request');
  const event = extractXmlTag(xmlText, 'Event');
  const cmd = extractXmlTag(xmlText, 'Cmd') || request || event || '';
  const terminalType = extractXmlTag(xmlText, 'TerminalType');
  const productName = extractXmlTag(xmlText, 'ProductName');
  const deviceId =
    extractXmlTag(xmlText, 'DeviceSerialNo') ||
    extractXmlTag(xmlText, 'CloudId') ||
    extractXmlTag(xmlText, 'DeviceSN') ||
    extractXmlTag(xmlText, 'SerialNumber') ||
    extractXmlTag(xmlText, 'DevId') ||
    '102026020002110';
  const logId = extractXmlTag(xmlText, 'LogID') || extractXmlTag(xmlText, 'LogId') || null;
  const rawUserId =
    extractXmlTag(xmlText, 'UserID') ||
    extractXmlTag(xmlText, 'UserId') ||
    extractXmlTag(xmlText, 'EnrollID') ||
    extractXmlTag(xmlText, 'EnrollId') ||
    extractXmlTag(xmlText, 'PIN') ||
    extractXmlTag(xmlText, 'Pin') ||
    extractXmlTag(xmlText, 'UserPin') ||
    null;
  const rawTimestamp =
    extractXmlTag(xmlText, 'Time') ||
    extractXmlTag(xmlText, 'DateTime') ||
    extractXmlTag(xmlText, 'Timestamp') ||
    extractXmlTag(xmlText, 'PunchTime') ||
    null;
  const action =
    extractXmlTag(xmlText, 'Action') ||
    extractXmlTag(xmlText, 'Mode') ||
    extractXmlTag(xmlText, 'VerifyMode') ||
    'Fingerprint';

  // 1. Device Registration Handshake
  if (cmd.toLowerCase() === 'register' || request?.toLowerCase() === 'register') {
    return {
      messageType: 'xml',
      frameKind: meta.frameKind || 'xml',
      category: 'device_registration',
      command: 'Register',
      keys: ['Request', 'TerminalType', 'ProductName', 'DeviceSerialNo', 'CloudId'],
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: xmlText.slice(0, 4000),
      rawPreview: xmlText.slice(0, 300),
      deviceId,
      logId,
      attendanceEvents: [],
      suggestedReply: `<?xml version="1.0"?>\n<Response>\n<Status>OK</Status>\n<Result>OK</Result>\n<Message>Register OK</Message>\n<DeviceSerialNo>${deviceId}</DeviceSerialNo>\n</Response>`,
    };
  }

  // 2. Heartbeat / Keepalive
  if (
    cmd.toLowerCase() === 'heartbeat' ||
    cmd.toLowerCase() === 'ping' ||
    cmd.toLowerCase() === 'keepalive' ||
    request?.toLowerCase() === 'heartbeat' ||
    event?.toLowerCase() === 'heartbeat'
  ) {
    return {
      messageType: 'xml',
      frameKind: meta.frameKind || 'xml',
      category: 'heartbeat',
      command: cmd || 'Heartbeat',
      keys: ['TerminalType', 'DeviceSerialNo'],
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: xmlText.slice(0, 4000),
      rawPreview: xmlText.slice(0, 300),
      deviceId,
      logId,
      attendanceEvents: [],
      suggestedReply: `<?xml version="1.0"?>\n<Response>\n<Status>OK</Status>\n<Result>OK</Result>\n</Response>`,
    };
  }

  // 3. Attendance Punch Push (e.g. TimeLog_v2 or any XML containing UserID/EnrollID)
  const isAttendance =
    rawUserId !== null ||
    cmd.toLowerCase().includes('timelog') ||
    cmd.toLowerCase().includes('att') ||
    cmd.toLowerCase().includes('punch') ||
    event?.toLowerCase().includes('timelog');

  if (isAttendance && rawUserId) {
    const biometricUserId = /^\d+$/.test(rawUserId) ? String(parseInt(rawUserId, 10)) : rawUserId;
    const attendanceTimestamp = normalizeDeviceTimestamp(rawTimestamp) || new Date().toISOString();
    const verificationMethod = mapVerificationMethod(action);

    return {
      messageType: 'xml',
      frameKind: meta.frameKind || 'xml',
      category: 'attendance_event',
      command: event || cmd || 'TimeLog_v2',
      keys: ['Event', 'UserID', 'Time', 'Action'],
      protocolRecognized: true,
      needsOfficialDocs: false,
      byteLength: meta.byteLength,
      rawText: xmlText.slice(0, 4000),
      rawPreview: xmlText.slice(0, 300),
      deviceId,
      logId,
      attendanceEvents: [
        {
          biometricUserId,
          rawBiometricUserId: rawUserId,
          deviceId,
          attendanceTimestamp,
          rawTimestamp: String(rawTimestamp || ''),
          verificationMethod,
          verificationResult: 'verified',
          inout: '0',
          eventId: logId,
          rawRecord: { xml: xmlText },
        },
      ],
      suggestedReply: `<?xml version="1.0"?>\n<Response>\n<Status>OK</Status>\n<Result>OK</Result>\n<LogID>${logId || '0'}</LogID>\n</Response>`,
    };
  }

  // 4. Fallback recognized Secureye / Realand XML command or response
  return {
    messageType: 'xml',
    frameKind: meta.frameKind || 'xml',
    category: 'xml_frame',
    command: cmd || null,
    keys: [],
    protocolRecognized: true,
    needsOfficialDocs: false,
    byteLength: meta.byteLength,
    rawText: xmlText.slice(0, 4000),
    rawPreview: xmlText.slice(0, 300),
    deviceId,
    attendanceEvents: [],
    suggestedReply: `<?xml version="1.0"?>\n<Response>\n<Status>OK</Status>\n<Result>OK</Result>\n</Response>`,
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
  const hasAttendanceFields =
    obj.enrollid !== undefined ||
    obj.enroll_id !== undefined ||
    obj.pin !== undefined ||
    obj.userId !== undefined ||
    obj.user_id !== undefined ||
    obj.userid !== undefined ||
    obj.empcode !== undefined ||
    obj.record !== undefined ||
    obj.records !== undefined ||
    obj.logs !== undefined;

  const isAttendanceCmd =
    cmd === 'sendlog' ||
    cmd === 'rtlog' ||
    cmd === 'attlog' ||
    cmd === 'attendance' ||
    cmd === 'pushlog' ||
    cmd === 'realtime' ||
    cmd === 'punch' ||
    cmd === 'userlog' ||
    cmd === 'sendattlog' ||
    cmd === 'att' ||
    cmd === 'log' ||
    cmd === 'verify' ||
    ret === 'getnewlog' ||
    ret === 'getalllog' ||
    hasAttendanceFields;

  if (isAttendanceCmd) {
    let rawRecords = [];
    if (Array.isArray(obj.record)) {
      rawRecords = obj.record;
    } else if (obj.record && typeof obj.record === 'object') {
      rawRecords = [obj.record];
    } else if (Array.isArray(obj.records)) {
      rawRecords = obj.records;
    } else if (obj.records && typeof obj.records === 'object') {
      rawRecords = [obj.records];
    } else if (Array.isArray(obj.logs)) {
      rawRecords = obj.logs;
    } else if (obj.logs && typeof obj.logs === 'object') {
      rawRecords = [obj.logs];
    } else if (Array.isArray(obj.data)) {
      rawRecords = obj.data;
    } else if (obj.data && typeof obj.data === 'object') {
      rawRecords = [obj.data];
    } else {
      const rootId =
        obj.enrollid ??
        obj.enroll_id ??
        obj.pin ??
        obj.userid ??
        obj.userId ??
        obj.user_id ??
        obj.empcode ??
        obj.id;
      if (rootId !== undefined && rootId !== null && rootId !== '') {
        rawRecords = [obj];
      }
    }

    const attendanceEvents = [];
    for (const rec of rawRecords) {
      if (!rec || typeof rec !== 'object') continue;
      const rawBioId = String(
        rec.enrollid ??
          rec.enroll_id ??
          rec.pin ??
          rec.userid ??
          rec.userId ??
          rec.user_id ??
          rec.empcode ??
          rec.id ??
          ''
      ).trim();

      if (!rawBioId) continue;

      // Normalize numeric ID by stripping leading zeroes (e.g. "00000123" -> "123")
      const biometricUserId = /^\d+$/.test(rawBioId) ? String(parseInt(rawBioId, 10)) : rawBioId;

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
        rawBiometricUserId: rawBioId,
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
