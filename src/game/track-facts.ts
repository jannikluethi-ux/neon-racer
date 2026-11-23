import type { Sample } from "./track";
import { buildCourse } from "./track";
import { themeFor, trackById } from "./track-def";

export type CourseFacts = {
  id: string;
  /** Centreline length in metres, from the same spline the race drives. */
  lengthM: number;
  /**
   * Corners counted from that spline: a run of curvature that turns the
   * heading by at least ~30°. Not a stored track field.
   */
  corners: number;
  /** Presentation label for the existing theme kind. */
  environment: string;
};

const ENV: Record<string, string> = {
  city: "City circuit",
  yard: "Elevated industrial",
  coast: "Coast highway",
  core: "Reactor complex",
};

const factsCache = new Map<string, CourseFacts>();

function countCorners(samples: readonly Sample[]): number {
  let corners = 0;
  let accum = 0;
  let hot = false;
  for (const sample of samples) {
    if (Math.abs(sample.curv) >= 0.018) {
      accum += sample.curv * sample.segLen;
      hot = true;
    } else if (hot) {
      if (Math.abs(accum) >= 0.55) corners += 1;
      accum = 0;
      hot = false;
    }
  }
  if (hot && Math.abs(accum) >= 0.55) corners += 1;
  return corners;
}

export function courseFacts(id: string): CourseFacts {
  const hit = factsCache.get(id);
  if (hit) return hit;
  const course = buildCourse(id);
  const theme = themeFor(course.themeId);
  const facts: CourseFacts = {
    id,
    lengthM: course.length,
    corners: countCorners(course.samples),
    environment: ENV[theme.kind] ?? trackById(id).difficulty,
  };
  factsCache.set(id, facts);
  return facts;
}

export function formatLength(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return "—";
  return `${(metres / 1000).toFixed(1)} km`;
}
