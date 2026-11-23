import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTRO_FADE_MS,
  INTRO_HINT_MS,
  INTRO_STALL_MS,
  INTRO_VIDEO_SRC,
  introBypassed,
  startIntro,
  type IntroEndReason,
  type IntroMedia,
} from "./intro-video.ts";

function clock() {
  let now = 0;
  let seq = 1;
  const items: { id: number; at: number; fn: () => void }[] = [];
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = seq++;
      items.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout(id: unknown) {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        items.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = items[0];
        if (!next || next.at > target) break;
        items.shift();
        now = next.at;
        next.fn();
      }
      now = target;
    },
  };
}

function fakeMedia(play: () => Promise<void>) {
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    src: "",
    muted: false,
    volume: 1,
    currentTime: 0,
    paused: false,
    loaded: 0,
    play,
    pause() {
      this.paused = true;
    },
    load() {
      this.loaded += 1;
    },
    removeAttribute(name: string) {
      if (name === "src") this.src = "";
    },
    addEventListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
  return media satisfies IntroMedia & {
    loaded: number;
    paused: boolean;
    emit(type: string): void;
  };
}

function harness(play: () => Promise<void> = () => Promise.resolve()) {
  const timer = clock();
  const state = {
    reasons: [] as IntroEndReason[],
    hints: 0,
    fades: 0,
    mutedFallbacks: 0,
  };
  const media = fakeMedia(play);
  const session = startIntro(media, {
    volume: 0.8,
    clock: timer,
    handlers: {
      onMenu: (reason) => state.reasons.push(reason),
      onFadeStart: () => {
        state.fades += 1;
      },
      onHint: () => {
        state.hints += 1;
      },
      onMutedFallback: () => {
        state.mutedFallbacks += 1;
      },
    },
  });
  return { timer, media, session, state };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("intro bypass", () => {
  it("skips the film for qa, compare, and skipIntro flags", () => {
    assert.equal(introBypassed("?qa=1"), true);
    assert.equal(introBypassed("?compare=1&unlock=1"), true);
    assert.equal(introBypassed("skipIntro=1"), true);
    assert.equal(introBypassed(""), false);
    assert.equal(introBypassed("?qa=0"), false);
  });
});

describe("intro playback", () => {
  it("hands the ended film to the menu after the fade and frees the element", () => {
    const run = harness();
    assert.equal(run.media.src, INTRO_VIDEO_SRC);
    run.media.emit("ended");
    assert.equal(run.state.fades, 1);
    assert.deepEqual(run.state.reasons, []);
    assert.equal(run.media.loaded, 0);
    run.timer.advance(INTRO_FADE_MS);
    assert.deepEqual(run.state.reasons, ["ended"]);
    assert.equal(run.media.src, "");
    assert.equal(run.media.paused, true);
    assert.equal(run.media.loaded, 1);
  });

  it("hands a skip to the menu after the fade", () => {
    const run = harness();
    run.session.skip();
    assert.deepEqual(run.state.reasons, []);
    run.timer.advance(INTRO_FADE_MS);
    assert.deepEqual(run.state.reasons, ["skip"]);
    assert.equal(run.media.loaded, 1);
  });

  it("hands a media error straight to the menu", () => {
    const run = harness();
    run.media.emit("error");
    assert.deepEqual(run.state.reasons, ["error"]);
    assert.equal(run.state.fades, 0);
    assert.equal(run.media.loaded, 1);
  });

  it("hands a stall longer than three seconds straight to the menu", () => {
    const run = harness();
    run.timer.advance(INTRO_STALL_MS - 1);
    assert.deepEqual(run.state.reasons, []);
    run.timer.advance(1);
    assert.deepEqual(run.state.reasons, ["stall"]);
    assert.equal(run.media.loaded, 1);
  });

  it("keeps playing when frames keep arriving inside the stall window", () => {
    const run = harness();
    run.timer.advance(2000);
    run.media.currentTime = 2;
    run.media.emit("timeupdate");
    run.timer.advance(INTRO_STALL_MS - 1);
    assert.deepEqual(run.state.reasons, []);
    run.timer.advance(1);
    assert.deepEqual(run.state.reasons, ["stall"]);
  });

  it("falls back to muted autoplay when unmuted play() is rejected", async () => {
    let attempts = 0;
    const run = harness(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("NotAllowedError"));
      return Promise.resolve();
    });
    await flush();
    assert.equal(attempts, 2);
    assert.equal(run.media.muted, true);
    assert.equal(run.state.mutedFallbacks, 1);
    assert.deepEqual(run.state.reasons, []);
    run.session.setVolume(1);
    assert.equal(run.media.muted, true);
  });

  it("opens the menu when muted autoplay is also rejected", async () => {
    const run = harness(() => Promise.reject(new Error("NotAllowedError")));
    await flush();
    assert.deepEqual(run.state.reasons, ["play-failed"]);
    assert.equal(run.media.loaded, 1);
  });

  it("starts muted when the game volume is zero", () => {
    const timer = clock();
    const media = fakeMedia(() => Promise.resolve());
    startIntro(media, { volume: 0, clock: timer, handlers: { onMenu() {} } });
    assert.equal(media.muted, true);
    assert.equal(media.volume, 0);
  });

  it("shows the skip hint after a second and skips motion when requested", () => {
    const run = harness();
    run.timer.advance(INTRO_HINT_MS - 1);
    assert.equal(run.state.hints, 0);
    run.timer.advance(1);
    assert.equal(run.state.hints, 1);

    const reasons: IntroEndReason[] = [];
    let played = false;
    const media = fakeMedia(() => {
      played = true;
      return Promise.resolve();
    });
    startIntro(media, {
      volume: 0.8,
      reducedMotion: true,
      handlers: { onMenu: (reason) => reasons.push(reason) },
    });
    assert.deepEqual(reasons, ["reduced-motion"]);
    assert.equal(played, false);
  });
});
