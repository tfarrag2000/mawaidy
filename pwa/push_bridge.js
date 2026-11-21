// Browser Web Push bridge for Mawaidy Flutter Web
window.mawaidyPush = {
  isSupported() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  },

  permission() {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission;
  },

  async subscribe(vapidPublicKey) {
    if (!this.isSupported()) return null;

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return null;

    const reg = await navigator.serviceWorker.register('push_sw.js');
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const raw = sub.toJSON();
    if (!raw || !raw.endpoint || !raw.keys || !raw.keys.p256dh || !raw.keys.auth) {
      return null;
    }

    return JSON.stringify({
      endpoint: raw.endpoint,
      p256dh: raw.keys.p256dh,
      auth: raw.keys.auth,
    });
  },

  async currentEndpoint() {
    if (!this.isSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration('push_sw.js');
    if (!reg) return null;
    const sub = await reg.pushManager.getSubscription();
    return sub ? sub.endpoint : null;
  },

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  },
};
