import { useGame } from "./store";

export type VisibilityTarget = Pick<
  Document,
  "hidden" | "addEventListener" | "removeEventListener"
>;

/** Binds the application's hidden-tab pause behavior to a visibility source. */
export function bindPauseOnHidden(target: VisibilityTarget, isRacing: () => boolean): () => void {
  const onVisibilityChange = () => {
    if (target.hidden && isRacing()) useGame.getState().setPaused(true);
  };
  target.addEventListener("visibilitychange", onVisibilityChange);
  return () => target.removeEventListener("visibilitychange", onVisibilityChange);
}
