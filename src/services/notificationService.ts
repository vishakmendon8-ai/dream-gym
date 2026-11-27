// Dream Gym Push Notification Service (Real VAPID Web Push + Service Worker)

const DEFAULT_PUSH_BACKEND =
  import.meta.env.VITE_BIOMETRIC_WS_BACKEND_URL ||
  'https://dream-gym-1.onrender.com';

function getPushBackendBase(): string {
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem('dreamgym_cloudrun_ws_url');
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  }
  return DEFAULT_PUSH_BACKEND.replace(/\/+$/, '');
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface ExpiryDispatchResult {
  memberId: string;
  memberName: string;
  daysLeft: number;
  planName: string;
  phone: string;
  channels: {
    systemPush: boolean;
    carrierSmsQueue: boolean;
    whatsAppAlert: boolean;
  };
  timestamp: string;
}

export class NotificationService {
  private static swRegistration: ServiceWorkerRegistration | null = null;

  public static async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.swRegistration = reg;
      return reg;
    } catch {
      return null;
    }
  }

  public static isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  public static getPermission(): NotificationPermission {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  public static async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await this.registerServiceWorker();
      }
      return permission;
    } catch {
      return 'denied';
    }
  }

  /**
   * Silently subscribe the member's browser/PWA to real VAPID Web Push
   * and register the encrypted PushSubscription on the backend server.
   */
  public static async subscribeMemberPush(member: {
    id: string;
    name: string;
    biometricId?: string;
  }): Promise<boolean> {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !this.isSupported()
    ) {
      return false;
    }

    try {
      if (Notification.permission !== 'granted') {
        return false;
      }

      const reg =
        this.swRegistration ||
        (await this.registerServiceWorker()) ||
        (await navigator.serviceWorker.ready);
      if (!reg || !reg.pushManager) return false;

      const base = getPushBackendBase();
      const keyResp = await fetch(`${base}/api/push/vapid-public-key`);
      const keyData = await keyResp.json();
      if (!keyResp.ok || !keyData?.ok || !keyData.publicKey) {
        return false;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as unknown as BufferSource,
        });
      }

      const saveResp = await fetch(`${base}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: member.id,
          memberName: member.name,
          biometricId: member.biometricId || '',
          subscription: sub.toJSON(),
        }),
      });

      return saveResp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a real Web Push notification through the backend (24h TTL, high urgency).
   */
  public static async sendServerPush(params: {
    targetMemberId?: string;
    biometricId?: string;
    title: string;
    body: string;
    url?: string;
    tag?: string;
  }): Promise<boolean> {
    try {
      const base = getPushBackendBase();
      const resp = await fetch(`${base}/api/push/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  public static async dispatchExpiryAlert(member: {
    id: string;
    name: string;
    daysLeft: number;
    planName: string;
    phone?: string;
    biometricId?: string;
  }): Promise<ExpiryDispatchResult> {
    const phone = member.phone || '';
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let systemPushDelivered = false;

    const title =
      member.daysLeft <= 1
        ? `Dream Gym: Plan Expires ${member.daysLeft <= 0 ? 'Today' : 'Tomorrow'}`
        : `Dream Gym: ${member.daysLeft} Days Left`;

    const body = `Hi ${member.name}, your ${member.planName} expires in ${Math.max(0, member.daysLeft)} days.`;

    // Send real Web Push through backend (reaches device in background / when reconnected)
    const serverSent = await this.sendServerPush({
      targetMemberId: member.id,
      biometricId: member.biometricId,
      title,
      body,
      url: '/member?screen=membership-details',
      tag: `dreamgym-expiry-${member.id}`,
    });

    if (serverSent) {
      systemPushDelivered = true;
    } else if (this.isSupported() && Notification.permission === 'granted') {
      try {
        if (!this.swRegistration && 'serviceWorker' in navigator) {
          this.swRegistration = await navigator.serviceWorker.ready;
        }
        if (this.swRegistration && 'showNotification' in this.swRegistration) {
          await (this.swRegistration as any).showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            vibrate: [200, 100, 200],
            tag: `dreamgym-expiry-${member.id}`,
            renotify: true,
            requireInteraction: true,
            data: { url: '/member?screen=membership-details', timestamp: Date.now() },
          });
          systemPushDelivered = true;
        }
      } catch {}
    }

    return {
      memberId: member.id,
      memberName: member.name,
      daysLeft: member.daysLeft,
      planName: member.planName,
      phone,
      channels: {
        systemPush: systemPushDelivered,
        carrierSmsQueue: false,
        whatsAppAlert: false,
      },
      timestamp,
    };
  }

  public static async scanAndNotifyExpiring(
    members: Array<{
      id: string;
      name: string;
      daysLeft: number;
      planName: string;
      phone?: string;
      biometricId?: string;
    }>
  ): Promise<ExpiryDispatchResult[]> {
    const expiring = members.filter((m) => m.daysLeft <= 7 && m.daysLeft >= 0);
    const results: ExpiryDispatchResult[] = [];
    for (const member of expiring) {
      results.push(await this.dispatchExpiryAlert(member));
    }
    return results;
  }
}
