import { useGame } from "./store";

export type VisibilityTarget = Pick<
  Document,
  "hidden" | "addEventListener" | "removeEventListener"
>;

export type BackgroundTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Binds the application's hidden-tab pause behavior to a visibility source. */
export function bindPauseOnHidden(target: VisibilityTarget, isRacing: () => boolean): () => void {
  const onVisibilityChange = () => {
    if (target.hidden && isRacing()) useGame.getState().setPaused(true);
  };
  target.addEventListener("visibilitychange", onVisibilityChange);
  return () => target.removeEventListener("visibilitychange", onVisibilityChange);
}

/** Pauses an active race when the native shell reports that its app was backgrounded. */
export function bindPauseOnBackground(
  target: BackgroundTarget,
  isRacing: () => boolean,
): () => void {
  const onBackground = () => {
    if (isRacing()) useGame.getState().setPaused(true);
  };
  target.addEventListener("neonracerbackground", onBackground);
  return () => target.removeEventListener("neonracerbackground", onBackground);
}
