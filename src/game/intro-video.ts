/**
 * Cold-start intro playback.
 *
 * The menu stays mounted underneath. This controller only decides when the
 * cover comes off, and it always releases the media element afterwards.
 */

export const INTRO_VIDEO_SRC = "/video/intro.mp4";
export const INTRO_POSTER_SRC = "/video/intro_poster.jpg";
export const INTRO_FADE_MS = 300;
export const INTRO_STALL_MS = 3000;
export const INTRO_HINT_MS = 1000;

export type IntroEndReason =
  "ended" | "skip" | "error" | "stall" | "play-failed" | "reduced-motion";

export interface IntroMedia {
  src: string;
  muted: boolean;
  volume: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface IntroClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface IntroHandlers {
  onMenu: (reason: IntroEndReason) => void;
  onFadeStart?: (reason: IntroEndReason) => void;
  onHint?: () => void;
  onMutedFallback?: () => void;
}

export interface IntroSession {
  skip(): void;
  setVolume(volume: number): void;
  release(): void;
}

export interface IntroOptions {
  volume: number;
  reducedMotion?: boolean;
  fadeMs?: number;
  stallMs?: number;
  hintMs?: number;
  clock?: IntroClock;
  handlers: IntroHandlers;
}

const realClock: IntroClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Automated runs pass `?qa=1`, `?compare=1`, or `?skipIntro=1` and skip the film. */
export function introBypassed(search: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  return (
    params.get("qa") === "1" || params.get("compare") === "1" || params.get("skipIntro") === "1"
  );
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

/**
 * Plays `media` with the game's volume. A rejected unmuted start retries muted.
 * End and skip fade out; a media error, a stall, or a failed muted start go
 * straight to the menu. `release` drops the decoder without opening the menu.
 */
export function startIntro(media: IntroMedia, options: IntroOptions): IntroSession {
  const clock = options.clock ?? realClock;
  const fadeMs = options.fadeMs ?? INTRO_FADE_MS;
  const stallMs = options.stallMs ?? INTRO_STALL_MS;
  const hintMs = options.hintMs ?? INTRO_HINT_MS;
  const { handlers } = options;

  let settled = false;
  let freed = false;
  let forcedMute = false;
  let lastTime = media.currentTime;
  let stallTimer: unknown = null;
  let hintTimer: unknown = null;
  let fadeTimer: unknown = null;
  const onEnded = () => finish("ended");
  const onError = () => finish("error");
  const onTimeUpdate = () => {
    if (media.currentTime <= lastTime + 0.001) return;
    lastTime = media.currentTime;
    armStall();
  };

  function armStall() {
    if (stallTimer != null) clock.clearTimeout(stallTimer);
    stallTimer = clock.setTimeout(() => finish("stall"), stallMs);
  }

  function clearTimers() {
    if (stallTimer != null) clock.clearTimeout(stallTimer);
    if (hintTimer != null) clock.clearTimeout(hintTimer);
    if (fadeTimer != null) clock.clearTimeout(fadeTimer);
    stallTimer = null;
    hintTimer = null;
    fadeTimer = null;
  }

  function unlisten() {
    media.removeEventListener("ended", onEnded);
    media.removeEventListener("error", onError);
    media.removeEventListener("timeupdate", onTimeUpdate);
  }

  function freeMedia() {
    if (freed) return;
    freed = true;
    try {
      media.pause();
    } catch {
      // The element can already be detached from the document.
    }
    media.removeAttribute("src");
    try {
      media.load();
    } catch {
      // load() throws if the element was removed mid-call.
    }
  }

  function finish(reason: IntroEndReason) {
    if (settled) return;
    settled = true;
    clearTimers();
    unlisten();
    const fade = reason === "ended" || reason === "skip";
    if (!fade) {
      freeMedia();
      handlers.onMenu(reason);
      return;
    }
    handlers.onFadeStart?.(reason);
    fadeTimer = clock.setTimeout(() => {
      fadeTimer = null;
      freeMedia();
      handlers.onMenu(reason);
    }, fadeMs);
  }

  function applyVolume(volume: number) {
    const level = clampVolume(volume);
    media.volume = forcedMute ? 0 : level;
    media.muted = forcedMute || level <= 0;
  }

  async function attemptPlay() {
    try {
      await media.play();
    } catch {
      if (settled || media.muted) {
        if (!settled) finish("play-failed");
        return;
      }
      forcedMute = true;
      media.muted = true;
      media.volume = 0;
      handlers.onMutedFallback?.();
      try {
        await media.play();
      } catch {
        if (!settled) finish("play-failed");
      }
    }
  }

  if (options.reducedMotion) {
    handlers.onMenu("reduced-motion");
    return {
      skip() {},
      setVolume() {},
      release() {},
    };
  }

  applyVolume(options.volume);
  if (!media.src) media.src = INTRO_VIDEO_SRC;
  media.addEventListener("ended", onEnded);
  media.addEventListener("error", onError);
  media.addEventListener("timeupdate", onTimeUpdate);
  armStall();
  hintTimer = clock.setTimeout(() => {
    hintTimer = null;
    if (!settled) handlers.onHint?.();
  }, hintMs);
  void attemptPlay();

  return {
    skip() {
      finish("skip");
    },
    setVolume(volume: number) {
      if (settled) return;
      applyVolume(volume);
    },
    release() {
      if (fadeTimer != null) clock.clearTimeout(fadeTimer);
      fadeTimer = null;
      if (!settled) {
        settled = true;
        clearTimers();
        unlisten();
      }
      freeMedia();
    },
  };
}
