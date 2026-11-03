import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { checkedOutputPath, outputRoots, pathInside, previewThumbnailPaths, repoRoot } from "./browser-guard.mjs";

process.env.BROWSER_GUARD_THROW = "1";

const shots = join(repoRoot(), "screenshots");

test("screenshot roots are the repo screenshots folder, not the whole project", () => {
  const roots = outputRoots();
  assert.ok(roots.some((dir) => dir.endsWith(`${join("screenshots")}`) || dir.endsWith("/screenshots")));
  assert.equal(pathInside(join(shots, "recon-2.1", "a.png"), shots), true);
  assert.equal(pathInside(join(repoRoot(), "src", "game", "vehicle.ts"), shots), false);
  assert.equal(pathInside(repoRoot(), shots), false);
});

test("checkedOutputPath accepts a screenshot and rejects escapes", () => {
  const ok = checkedOutputPath(join(shots, "recon-2.1", "flat.png"), [shots]);
  assert.equal(ok, resolve(shots, "recon-2.1", "flat.png"));
  assert.throws(() => checkedOutputPath(join(shots, "..", "src", "game", "vehicle.ts"), [shots]), /must be under/);
  assert.throws(() => checkedOutputPath(join(shots, "..", "..", "etc", "passwd"), [shots]), /must be under/);
  assert.throws(() => checkedOutputPath(encodeURIComponent("../src/game/vehicle.ts").replace(/%2F/gi, "/"), [shots]), /must be under/);
  assert.throws(() => checkedOutputPath(`${shots}/%2e%2e/%2e%2e/etc/passwd`, [shots]), /must be under/);
  assert.throws(() => checkedOutputPath(`${shots}/%252e%252e/%252e%252e/etc/passwd`, [shots]), /must be under/);
  assert.throws(() => checkedOutputPath(`${shots}\\..\\src\\game\\vehicle.ts`, [shots]), /backslashes/);
  assert.throws(() => checkedOutputPath(join(repoRoot(), "package.json"), [shots]), /must be under/);
});

test("a sibling directory with the same prefix is not inside", () => {
  const dir = mkdtempSync(join(tmpdir(), "neon-guard-"));
  const allowed = join(dir, "screenshots");
  writeFileSync(join(dir, "screenshots-evil"), "nope");
  assert.equal(pathInside(join(dir, "screenshots-evil"), allowed), false);
  assert.throws(() => checkedOutputPath(join(dir, "screenshots-evil"), [allowed]), /must be under/);
});

test("symlinks cannot redirect an allowed screenshot path outside its directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "neon-guard-link-"));
  const allowed = join(dir, "screenshots");
  const outside = join(dir, "outside");
  mkdirSync(allowed);
  mkdirSync(outside);
  symlinkSync(outside, join(allowed, "escape"), "dir");
  assert.equal(pathInside(join(allowed, "escape", "image.png"), allowed), false);
  assert.throws(() => checkedOutputPath(join(allowed, "escape", "image.png"), [allowed]), /must be under/);
});

test("symlink cycles fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "neon-guard-cycle-"));
  const allowed = join(dir, "screenshots");
  mkdirSync(allowed);
  symlinkSync("second", join(allowed, "first"));
  symlinkSync("first", join(allowed, "second"));
  assert.throws(() => checkedOutputPath(join(allowed, "first", "image.png"), [allowed]), /symlink cycle/);
});

test("the preview thumbnail contract allows one exact temp file, not the temp directory", () => {
  for (const target of previewThumbnailPaths()) {
    assert.equal(checkedOutputPath(target, []), resolve(target));
  }
  assert.throws(() => checkedOutputPath(join(tmpdir(), "other-image.png"), []), /must be under/);
});
