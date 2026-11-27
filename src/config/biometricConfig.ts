/**
 * Built-in Biometric Server & Hardware Configuration for Dream Gym.
 *
 * Pre-configured inside the web app (and optionally overridden at build/deploy
 * time via Vite environment variables in Vercel / Render) so gym clients never
 * have to fill in or maintain server URLs, WebSocket endpoints, or API secrets.
 */

const rawServerUrl = (
  import.meta.env.VITE_BIOMETRIC_WS_BACKEND_URL ||
  import.meta.env.VITE_BIOMETRIC_SERVER_URL ||
  import.meta.env.VITE_ADMS_API_URL ||
  'https://dream-gym-1.onrender.com'
)
  .trim()
  .replace(/\/+$/, '');

function deriveWssUrl(httpUrl: string): string {
  const customWs = (import.meta.env.VITE_BIOMETRIC_WS_URL || '').trim();
  if (customWs) return customWs;
  const wsBase = httpUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  return `${wsBase}/biometric`;
}

export function getBiometricBackendUrl(): string {
  if (typeof window === 'undefined') {
    return (import.meta.env.VITE_BIOMETRIC_WS_BACKEND_URL || 'https://dream-gym-1.onrender.com').trim().replace(/\/+$/, '');
  }

  const saved = localStorage.getItem('dreamgym_biometric_server_url');
  if (saved) return saved.trim().replace(/\/+$/, '');

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8080';
  }
  if (host.startsWith('192.168.')) {
    return `http://${host}:8080`;
  }

  return (import.meta.env.VITE_BIOMETRIC_WS_BACKEND_URL || 'https://dream-gym-1.onrender.com').trim().replace(/\/+$/, '');
}

export function setBiometricBackendUrl(url: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('dreamgym_biometric_server_url', url.trim().replace(/\/+$/, ''));
}

export const BIOMETRIC_CONFIG = {
  /** Pre-configured cloud biometric backend URL (zero client setup required). */
  get serverUrl() {
    return getBiometricBackendUrl();
  },

  /** Derived WSS URL for the physical Secureye terminal (/biometric). */
  get wsUrl() {
    return deriveWssUrl(getBiometricBackendUrl());
  },

  /**
   * Optional deploy-time API secret (set VITE_BIOMETRIC_API_SECRET in Vercel /
   * Render environment variables — never asked from gym clients in the UI).
   */
  apiToken: (import.meta.env.VITE_BIOMETRIC_API_SECRET || '').trim(),

  /** Verified physical Secureye terminal details built into the app. */
  defaultTerminal: {
    name: import.meta.env.VITE_BIOMETRIC_DEVICE_NAME || 'Main Entrance Secureye Terminal',
    serialNumber: import.meta.env.VITE_BIOMETRIC_DEVICE_SN || '102026020002110',
    cloudId: import.meta.env.VITE_BIOMETRIC_DEVICE_SN || '102026020002110',
    p2pCloudId: import.meta.env.VITE_BIOMETRIC_P2P_ID || 'BD77B4BE-3765DCD',
    ipAddress: import.meta.env.VITE_BIOMETRIC_DEVICE_IP || '192.168.1.101',
    p2pPort: 4000,
  },
} as const;
