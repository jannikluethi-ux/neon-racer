#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const webDir = join(root, "dist-android", "client");
const result = spawnSync(
  process.execPath,
  [
    join(root, "scripts", "with-app-env.mjs"),
    "vite",
    "build",
    "--config",
    "vite.android.config.ts",
    "--mode",
    "android",
  ],
  { cwd: root, stdio: "inherit", env: process.env },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (!existsSync(join(webDir, "index.html"))) {
  throw new Error(`Android SPA build did not produce ${join(webDir, "index.html")}`);
}

// TanStack builds a server renderer to prerender the SPA shell. Capacitor only
// consumes the client directory; remove the build-time renderer from output.
rmSync(join(root, "dist-android", "server"), { recursive: true, force: true });
console.log(`Static Android web assets: ${webDir}`);
