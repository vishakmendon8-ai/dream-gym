/**
 * Runtime configuration for the dedicated Google Cloud Run Secureye WebSocket Server.
 * Uses Google Secret Manager env injections or Cloud Run ADC for Firebase Admin SDK.
 */

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  isCloudRun: Boolean(process.env.K_SERVICE),
  cloudRunService: process.env.K_SERVICE || null,
  cloudRunRevision: process.env.K_REVISION || null,
  firebaseProjectId:
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'gym001-50a97',
  biometricApiSecret: (process.env.BIOMETRIC_API_SECRET || '').trim(),
  timezoneOffsetHours: Number(process.env.DEVICE_TIMEZONE_OFFSET ?? 5.5),
  heartbeatIntervalMs: Number(process.env.WS_HEARTBEAT_INTERVAL_MS || 25_000),

  // Verified physical Secureye device metadata (no invented fields)
  defaultDevice: {
    brand: 'Secureye',
    serialNumber: process.env.SECUREYE_SERIAL_NUMBER || '102026020002110',
    cloudId: process.env.SECUREYE_CLOUD_ID || '102026020002110',
    deviceUniqueId: process.env.SECUREYE_UNIQUE_ID || 'BD77B4BE-3765DCD',
    localIp: process.env.SECUREYE_LOCAL_IP || '192.168.1.101',
    subnetMask: '255.255.255.0',
    gateway: '192.168.1.1',
    p2pServerIp: process.env.SECUREYE_P2P_IP || '54.187.2.68',
    p2pServerPort: Number(process.env.SECUREYE_P2P_PORT || 4000),
    tcpPort: Number(process.env.SECUREYE_TCP_PORT || 5005),
    communicationPassword: false,
    serverClientMode: 'WebSocket',
    p2pLinkStatus: 'Registered',
  },
};
