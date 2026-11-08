/** 是否跑在 Capacitor 壳里（APK）。Web 端恒为 false，不影响浏览器行为。 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/** 手机端：记住上次进入的城市码，重开 App 直接接着玩 */
export const LAST_SESSION_KEY = "city20:last-session";
