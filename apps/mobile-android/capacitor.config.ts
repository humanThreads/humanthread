import type { CapacitorConfig } from "@capacitor/cli";

const deploymentUrl =
  process.env.HUMANTHREAD_MOBILE_SERVER_URL?.trim() || "http://localhost:3000";

const config: CapacitorConfig = {
  appId: "com.humanthread.mobile",
  appName: "HumanThread",
  webDir: "www",
  server: {
    url: deploymentUrl,
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
