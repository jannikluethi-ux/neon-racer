/**
 * Target checks shared by the Playwright capture scripts.
 *
 * The browser checks are restricted to loopback URLs and repository screenshot
 * directories so they cannot render local files or write arbitrary paths.
 */
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Repository root, from this file's location — never a machine-specific path. */
export function repoRoot() {
  return resolve(fileURLToPath(new URL("..", import.meta.url)));
}

/** The one temporary image used by the preview thumbnail service contract. */
export function previewThumbnailPaths() {
  return [...new Set([resolve(tmpdir(), "preview-thumbnail.png"), resolve("/tmp", "preview-thumbnail.png")])];
}

/** Screenshots and verdicts stay under the repository's screenshots folder. */
export function outputRoots() {
  const root = resolve(repoRoot(), "screenshots");
  const canonicalRepo = realpathSync(repoRoot());
  if (!pathInside(canonicalPath(root), canonicalRepo)) {
    fail("the repository screenshots directory must stay inside the repository");
  }
  return [root];
}

/** http/https loopback only, else exit 1. `BROWSER_ALLOW_EXTERNAL_HOST=1` opts out. */
export function checkedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`not a valid URL: ${url}`);
  }
  // Rules out file:, data:, chrome:, view-source:.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(`only http/https URLs are allowed, got ${parsed.protocol} in ${url}`);
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname) && process.env.BROWSER_ALLOW_EXTERNAL_HOST !== "1") {
    fail(
      `${parsed.hostname} is not a loopback host; these scripts screenshot the ` +
        `local dev server. Set BROWSER_ALLOW_EXTERNAL_HOST=1 to override.`,
    );
  }
  return url;
}

function decodePath(target) {
  if (typeof target !== "string" || target.includes("\0")) {
    fail("screenshot path is empty or contains a null byte");
  }
  if (target.includes("\\")) fail("screenshot paths cannot contain backslashes");
  // Decode repeatedly so nested forms such as `%252e%252e` cannot bypass the
  // same containment check used for ordinary `../` segments.
  let decoded = target;
  for (let i = 0; i < 8; i++) {
    if (!decoded.includes("%")) return decoded;
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      fail("screenshot path contains invalid percent encoding");
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  fail("screenshot path has too many encoding layers");
}

/** Canonicalize through the nearest existing parent, including symlinks. */
function canonicalPath(path, seenLinks = new Set()) {
  const abs = resolve(path);
  let cursor = abs;
  const tail = [];
  while (true) {
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        if (seenLinks.has(cursor)) fail(`screenshot path contains a symlink cycle: ${cursor}`);
        seenLinks.add(cursor);
        const link = readlinkSync(cursor);
        return resolve(canonicalPath(resolve(dirname(cursor), link), seenLinks), ...tail);
      }
      return resolve(realpathSync(cursor), ...tail);
    } catch (error) {
      if (error?.code === "ELOOP") fail(`screenshot path contains a symlink cycle: ${cursor}`);
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return abs;
    tail.unshift(basename(cursor));
    cursor = parent;
  }
}

/** True when `abs` is strictly inside `dir` (not the directory itself). */
export function pathInside(abs, dir) {
  const root = canonicalPath(dir);
  const target = canonicalPath(abs);
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Absolute `target` if it is strictly inside `allowedDirs`, else exit 1. */
export function checkedOutputPath(target, allowedDirs, label = "screenshot") {
  const decoded = decodePath(target);
  const abs = resolve(decoded);
  const canonicalTarget = canonicalPath(abs);
  const isPreviewThumbnail = previewThumbnailPaths().some((path) => canonicalPath(path) === canonicalTarget);
  const allowed = isPreviewThumbnail || allowedDirs.some((dir) => pathInside(abs, dir.endsWith(sep) ? dir.slice(0, -1) : dir));
  if (!allowed) {
    fail(`${label} path must be under ${allowedDirs.join(" or ")}, got ${abs}`);
  }
  return abs;
}

export class GuardError extends Error {}

function fail(message) {
  if (process.env.BROWSER_GUARD_THROW === "1") throw new GuardError(message);
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
