import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { INTRO_POSTER_SRC, introBypassed, startIntro, type IntroSession } from "@/game/intro-video";

/**
 * Full-screen cold-start film. The poster is painted with the first frame of
 * this overlay; playback, the skip hint, and the fade live in `startIntro`.
 */
export function IntroVideo({ volume, onDone }: { volume: number; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<IntroSession | null>(null);
  const volumeRef = useRef(volume);
  const onDoneRef = useRef(onDone);
  const [hint, setHint] = useState(false);
  const [fading, setFading] = useState(false);
  volumeRef.current = volume;
  onDoneRef.current = onDone;

  useLayoutEffect(() => {
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || introBypassed(window.location.search)) {
      onDoneRef.current();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const session = startIntro(video, {
      volume: volumeRef.current,
      handlers: {
        onHint: () => setHint(true),
        onFadeStart: () => setFading(true),
        onMenu: () => onDoneRef.current(),
      },
    });
    sessionRef.current = session;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Escape" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      session.skip();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      session.release();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.setVolume(volume);
  }, [volume]);

  return (
    <div
      className={`intro-video${fading ? " is-fading" : ""}`}
      data-intro-video="1"
      data-intro-state={fading ? "fading" : "playing"}
    >
      <video
        ref={videoRef}
        className="intro-video-media"
        poster={INTRO_POSTER_SRC}
        playsInline
        preload="auto"
        disablePictureInPicture
      />
      <button
        type="button"
        className="intro-video-hit"
        aria-label="Skip intro"
        onClick={() => sessionRef.current?.skip()}
      />
      {hint ? <p className="intro-video-hint">Tap to skip</p> : null}
    </div>
  );
}
