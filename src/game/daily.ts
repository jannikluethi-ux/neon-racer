import { TRACKS } from "./track-def";
import { VEHICLES } from "./vehicle-def";

export type DailyEvent = {
  key: string;
  label: string;
  trackId: string;
  vehicleId: string;
};

/**
 * A deterministic local event. It keeps the game fresh without requiring an
 * account, a backend, or a network request: every player sees the same car +
 * circuit combination for a given UTC day.
 */
export function dailyEvent(now = new Date()): DailyEvent {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const start = Date.UTC(year, 0, 1);
  const day = Math.floor((Date.UTC(year, month, date) - start) / 86_400_000);
  const track = TRACKS[day % TRACKS.length]!;
  const vehicle = VEHICLES[(day * 3 + 1) % VEHICLES.length]!;
  const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, date)));
  return { key, label, trackId: track.id, vehicleId: vehicle.id };
}
