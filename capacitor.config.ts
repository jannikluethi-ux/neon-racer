import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.neonracer.app",
  appName: "Neon Racer",
  webDir: "dist-android/client",
  android: {
    backgroundColor: "#07060c",
  },
};

export default config;
