#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const isWindows = process.platform === "win32";
const javaCommand = isWindows ? "java.exe" : "java";

function javaHomes() {
  const home = homedir();
  const configured = [process.env.ANDROID_STUDIO_JBR, process.env.JAVA_HOME].filter(Boolean);
  if (process.platform === "darwin") {
    configured.push(
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
      join(home, "Applications/Android Studio.app/Contents/jbr/Contents/Home"),
      "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home",
    );
  } else if (process.platform === "linux") {
    configured.push(
      "/opt/android-studio/jbr",
      "/usr/local/android-studio/jbr",
      join(home, ".local/share/Google/AndroidStudio/jbr"),
    );
  } else if (isWindows) {
    configured.push(join(process.env.LOCALAPPDATA ?? "", "Programs/Android Studio/jbr"));
  }
  return [...new Set(configured)];
}

const javaHome = javaHomes().find((candidate) => existsSync(join(candidate, "bin", javaCommand)));
const sdkHome =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");

if (!javaHome) {
  throw new Error("Android Studio's bundled JDK was not found. Set ANDROID_STUDIO_JBR or JAVA_HOME.");
}
if (!existsSync(join(sdkHome, "platform-tools"))) {
  throw new Error(`Android SDK was not found at ${sdkHome}. Set ANDROID_HOME or ANDROID_SDK_ROOT.`);
}

const env = {
  ...process.env,
  ANDROID_HOME: sdkHome,
  ANDROID_SDK_ROOT: sdkHome,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, "bin")}${delimiter}${process.env.PATH ?? ""}`,
};

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm", ["run", "build:android"]);
run(isWindows ? "npx.cmd" : "npx", ["cap", "sync", "android"]);
run(isWindows ? "gradlew.bat" : "./gradlew", ["assembleDebug"], join(root, "android"));

const apk = join(root, "android/app/build/outputs/apk/debug/app-debug.apk");
if (!existsSync(apk)) throw new Error(`Gradle succeeded but did not produce ${apk}`);
const deliverable = join(root, "apk/neon-racer-debug.apk");
mkdirSync(join(root, "apk"), { recursive: true });
copyFileSync(apk, deliverable);
const bytes = statSync(deliverable).size;
console.log(`Debug APK: ${deliverable}`);
console.log(`APK size: ${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} bytes)`);
console.log(`Android SDK: ${sdkHome}`);
console.log(`Android Studio JDK: ${javaHome}`);
