import type { CapacitorConfig } from "@capacitor/cli";

/** Android 包：静态导出的 Web 直接打进 APK，无后端、无网络依赖 */
const config: CapacitorConfig = {
  appId: "com.city20.game",
  appName: "CITY20",
  webDir: "out",
  server: { androidScheme: "https" },
};

export default config;
