// Тонкая обёртка над Telegram WebApp SDK, безопасная вне Telegram
export const tg: any = (window as any).Telegram?.WebApp;
export const inTelegram = Boolean(tg?.initData);

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#1B1E21');
    tg.setBackgroundColor?.('#1B1E21');
    tg.disableVerticalSwipes?.();
  } catch { /* старые клиенты */ }
}

export function haptic(kind: 'light' | 'success' | 'error' | 'warning' = 'light') {
  try {
    if (kind === 'light') tg?.HapticFeedback?.impactOccurred('light');
    else tg?.HapticFeedback?.notificationOccurred(kind);
  } catch { /* */ }
}

export function confirmDialog(message: string): Promise<boolean> {
  if (tg?.showConfirm && tg.isVersionAtLeast?.('6.2')) return new Promise((res) => tg.showConfirm(message, (ok: boolean) => res(ok)));
  return Promise.resolve(window.confirm(message));
}

export function openInvoice(url: string): Promise<string> {
  if (tg?.openInvoice) return new Promise((res) => tg.openInvoice(url, (status: string) => res(status)));
  window.open(url, '_blank');
  return Promise.resolve('opened');
}
