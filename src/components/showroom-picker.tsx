import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { carMedal, carRequirement, medalName, RACE_MARKS, trackRequirement } from "@/game/mastery";
import { formatRaceTime } from "@/game/math";
import { isTrackUnlocked, isVehicleUnlocked, SAVE_VERSION } from "@/game/save";
import { clampPitch, clampZoom, retarget, showcase, wrapIndex, type ShowcaseView } from "@/game/showcase";
import { useGame } from "@/game/store";
import { courseFacts, formatLength } from "@/game/track-facts";
import { TRACKS } from "@/game/track-def";
import { VEHICLES, vehicleById } from "@/game/vehicle-def";
import { measureVehicle, STAT_SCALES, type VehicleStats } from "@/game/vehicle-stats";

function snapshot() {
  const s = useGame.getState();
  return {
    saveVersion: SAVE_VERSION,
    unlockedVehicles: s.unlockedVehicles,
    unlockedTracks: s.unlockedTracks,
    selectedVehicle: s.selectedVehicle,
    selectedTrack: s.selectedTrack,
    trackRecords: s.records,
    trackMastery: s.trackMastery,
    carMastery: s.carMastery,
    career: s.career,
    challenges: s.challenges,
    settings: {
      quality: s.quality,
      volume: s.volume,
      steerSens: s.steerSens,
      touch: s.touch,
      autoAccelerate: s.autoAccelerate,
      difficulty: s.difficulty,
    },
    championship: s.cup,
  };
}

function classToken(name: string): string | null {
  return /\b(GT3|GT4|LMP|TCR|PROTO|CONCEPT)\b/.exec(name)?.[1] ?? null;
}

const VIEWS: ShowcaseView[] = ["front", "side", "rear"];

function useCarouselKeys(
  kind: "car" | "track",
  onStep: (dir: number) => void,
  onView: (view: ShowcaseView) => void,
) {
  const stepRef = useRef(onStep);
  const viewRef = useRef(onView);
  stepRef.current = onStep;
  viewRef.current = onView;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        event.preventDefault();
        stepRef.current(-1);
      } else if (event.code === "ArrowRight" || event.code === "KeyD") {
        event.preventDefault();
        stepRef.current(1);
      } else if (event.code === "Digit1") viewRef.current("front");
      else if (event.code === "Digit2") viewRef.current("side");
      else if (event.code === "Digit3") viewRef.current("rear");
    };
    window.addEventListener("keydown", onKey);
    let raf = 0;
    let stick = 0;
    let left = false;
    let right = false;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads?.() ?? [];
      let axis = 0;
      let dLeft = false;
      let dRight = false;
      for (const pad of pads) {
        if (!pad) continue;
        const x = pad.axes[0] ?? 0;
        if (Math.abs(x) > 0.62) axis = Math.sign(x);
        dLeft = dLeft || Boolean(pad.buttons[14]?.pressed);
        dRight = dRight || Boolean(pad.buttons[15]?.pressed);
      }
      if (axis !== 0 && stick === 0) stepRef.current(axis);
      stick = axis;
      if (dLeft && !left) stepRef.current(-1);
      if (dRight && !right) stepRef.current(1);
      left = dLeft;
      right = dRight;
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      if (showcase.dragging === kind) showcase.dragging = null;
    };
  }, [kind]);
}

function StageHit({
  kind,
  count,
  onPreview,
  onSettle,
}: {
  kind: "car" | "track";
  count: number;
  onPreview: (index: number) => void;
  onSettle: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{
    origin: number;
    x: number;
    y: number;
    pitch: number;
    zoom: number;
    pinch: number | null;
  } | null>(null);
  const field = kind === "car" ? "car" : "track";
  const target = kind === "car" ? "carTarget" : "trackTarget";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      showcase.zoom = clampZoom(showcase.zoom + Math.sign(event.deltaY) * 0.06);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!drag.current) {
      drag.current = {
        origin: showcase[field],
        x: event.clientX,
        y: event.clientY,
        pitch: showcase.pitch,
        zoom: showcase.zoom,
        pinch: null,
      };
      showcase.dragging = kind;
    }
    if (pointers.current.size === 2 && drag.current) {
      const pts = [...pointers.current.values()];
      drag.current.pinch = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      drag.current.zoom = showcase.zoom;
    }
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !drag.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (drag.current.pinch != null && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      showcase.zoom = clampZoom(drag.current.zoom * (drag.current.pinch / Math.max(48, dist)));
      return;
    }
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (Math.abs(dx) < 5) return;
      const span = Math.max(180, event.currentTarget.clientWidth * 0.3);
      showcase[field] = drag.current.origin - dx / span;
      showcase[target] = showcase[field];
      onPreview(wrapIndex(showcase[field], count));
    } else {
      showcase.pitch = clampPitch(drag.current.pitch - dy / 380);
    }
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) {
      if (drag.current) drag.current.pinch = null;
      return;
    }
    const snapped = Math.round(showcase[field]);
    showcase[target] = snapped;
    showcase.dragging = null;
    drag.current = null;
    onSettle(wrapIndex(snapped, count));
  };

  return (
    <div
      ref={ref}
      className="stage-hit"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      role="presentation"
    />
  );
}

function ViewChips({ view, onView }: { view: ShowcaseView; onView: (view: ShowcaseView) => void }) {
  return (
    <div className="view-chips" role="group" aria-label="Camera">
      {VIEWS.map((id) => (
        <button key={id} type="button" className="chip" aria-pressed={view === id} onClick={() => onView(id)}>
          {id}
        </button>
      ))}
    </div>
  );
}

function StatLine({ label, value, fill }: { label: string; value: string; fill: number }) {
  return (
    <p className="stat stat-wide">
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%` }} />
      </i>
      <em>{value}</em>
    </p>
  );
}

export function CarSelect() {
  const selected = useGame((s) => s.selectedVehicle);
  const flow = useGame((s) => s.flow);
  const unlocked = useGame((s) => s.unlockedVehicles);
  const unlockAll = useGame((s) => s.unlockAll);
  const pick = useGame((s) => s.selectVehicle);
  const open = useGame((s) => s.openScreen);
  const mastery = useGame((s) => s.carMastery);
  const [focus, setFocus] = useState(() => {
    const idx = Math.max(0, VEHICLES.findIndex((car) => car.id === useGame.getState().selectedVehicle));
    showcase.car = idx;
    showcase.carTarget = idx;
    return idx;
  });
  const [view, setView] = useState<ShowcaseView>(showcase.view);
  const save = snapshot();
  const def = VEHICLES[focus] ?? VEHICLES[0]!;
  const openCar = isVehicleUnlocked(def.id, { ...save, unlockedVehicles: unlocked }, unlockAll);
  const stats: VehicleStats = measureVehicle(def);
  const row = mastery[def.id];
  const recognition = carMedal(row);
  const rule = openCar ? null : carRequirement(def.id, { ...save, unlockedVehicles: unlocked, carMastery: mastery });
  const token = classToken(def.name);
  const count = VEHICLES.length;

  const settle = (index: number) => {
    const idx = wrapIndex(index, count);
    setFocus(idx);
    const car = VEHICLES[idx];
    if (car && isVehicleUnlocked(car.id, { ...save, unlockedVehicles: unlocked }, unlockAll)) pick(car.id);
  };

  const step = (dir: number) => {
    const idx = wrapIndex(Math.round(showcase.carTarget) + dir, count);
    showcase.carTarget = retarget(showcase.carTarget, idx, count);
    settle(idx);
  };

  const chooseView = (next: ShowcaseView) => {
    showcase.view = next;
    setView(next);
  };

  useCarouselKeys("car", step, chooseView);

  return (
    <section className="picker" data-carousel="cars" data-focus={def.id} data-view={view}>
      <header className="picker-top">
        <p className="eyebrow">Garage</p>
        <ViewChips view={view} onView={chooseView} />
      </header>
      <button type="button" className="chev chev-left" aria-label="Previous car" onClick={() => step(-1)}>
        ‹
      </button>
      <button type="button" className="chev chev-right" aria-label="Next car" onClick={() => step(1)}>
        ›
      </button>
      <StageHit kind="car" count={count} onPreview={setFocus} onSettle={settle} />
      <footer className="picker-dock">
        <div className="dock-copy">
          <h2>
            {def.name}
            {token ? <small className="class-chip">{token}</small> : null}
          </h2>
          <p>{def.description}</p>
          {rule ? (
            <p className="lock-note">
              Locked · {rule.requirement}
              <br />
              {rule.progress}
              <br />
              Race car stays {vehicleById(selected).name}
            </p>
          ) : (
            <p className="dock-meta">
              {selected === def.id ? "Selected" : "In view"} · {medalName(recognition) === "—" ? "No medal" : medalName(recognition)} · {row?.wins ?? 0} wins
            </p>
          )}
        </div>
        <div className="dock-stats">
          <StatLine label="Accel" value={stats.launch.toFixed(1)} fill={stats.launch / STAT_SCALES.launch} />
          <StatLine label="Speed" value={`${Math.round(stats.topKmh)}`} fill={stats.topKmh / STAT_SCALES.topKmh} />
          <StatLine label="Grip" value={stats.grip.toFixed(1)} fill={stats.grip / STAT_SCALES.grip} />
          <StatLine label="Brake" value={stats.brake.toFixed(1)} fill={stats.brake / STAT_SCALES.brake} />
        </div>
        <div className="stack picker-actions">
          {flow === "race" ? (
            <button type="button" className="btn btn-primary" disabled={!openCar} onClick={() => open("tracks", "race")}>
              Next — track
            </button>
          ) : flow === "cup" ? (
            <button type="button" className="btn btn-primary" disabled={!openCar} onClick={() => open("cup-diff", "cup")}>
              Next — difficulty
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!openCar} onClick={() => open("title", "browse")}>
              Done
            </button>
          )}
          <button type="button" className="btn" onClick={() => open(flow === "cup" ? "cup" : "title", flow === "race" ? "browse" : flow)}>
            Back
          </button>
        </div>
      </footer>
    </section>
  );
}

export function TrackSelect() {
  const selected = useGame((s) => s.selectedTrack);
  const carName = useGame((s) => vehicleById(s.selectedVehicle).name);
  const flow = useGame((s) => s.flow);
  const records = useGame((s) => s.records);
  const unlocked = useGame((s) => s.unlockedTracks);
  const unlockAll = useGame((s) => s.unlockAll);
  const pick = useGame((s) => s.selectTrack);
  const open = useGame((s) => s.openScreen);
  const mastery = useGame((s) => s.trackMastery);
  const [focus, setFocus] = useState(() => {
    const idx = Math.max(0, TRACKS.findIndex((track) => track.id === useGame.getState().selectedTrack));
    showcase.track = idx;
    showcase.trackTarget = idx;
    return idx;
  });
  const [view, setView] = useState<ShowcaseView>(showcase.view);
  const save = snapshot();
  save.unlockedTracks = unlocked;
  const def = TRACKS[focus] ?? TRACKS[0]!;
  const openTrack = isTrackUnlocked(def.id, save, unlockAll);
  const facts = courseFacts(def.id);
  const row = records[def.id];
  const learned = mastery[def.id];
  const medal = learned?.medal ?? "none";
  const rule = openTrack ? null : trackRequirement(def.id, save);
  const mark = RACE_MARKS[def.id];
  const count = TRACKS.length;

  const settle = (index: number) => {
    const idx = wrapIndex(index, count);
    setFocus(idx);
    const track = TRACKS[idx];
    if (track && isTrackUnlocked(track.id, save, unlockAll)) pick(track.id);
  };

  const step = (dir: number) => {
    const idx = wrapIndex(Math.round(showcase.trackTarget) + dir, count);
    showcase.trackTarget = retarget(showcase.trackTarget, idx, count);
    settle(idx);
  };

  const chooseView = (next: ShowcaseView) => {
    showcase.view = next;
    setView(next);
  };

  useCarouselKeys("track", step, chooseView);

  const canStart = openTrack;

  return (
    <section className="picker" data-carousel="tracks" data-focus={def.id}>
      <header className="picker-top">
        <div>
          <p className="eyebrow">Circuits</p>
          <p className="dock-meta">{carName}</p>
        </div>
        <ViewChips view={view} onView={chooseView} />
      </header>
      <button type="button" className="chev chev-left" aria-label="Previous track" onClick={() => step(-1)}>
        ‹
      </button>
      <button type="button" className="chev chev-right" aria-label="Next track" onClick={() => step(1)}>
        ›
      </button>
      <StageHit kind="track" count={count} onPreview={setFocus} onSettle={settle} />
      <footer className="picker-dock">
        <div className="dock-copy">
          <h2>{def.name}</h2>
          <p>
            {facts.environment} · {formatLength(facts.lengthM)} · {facts.corners} {facts.corners === 1 ? "corner" : "corners"} · {def.laps} laps
          </p>
          <p>{rule ? rule.requirement : def.blurb}</p>
          {rule ? <p className="lock-note">{rule.progress}</p> : null}
          <p className="dock-meta">
            {selected === def.id ? "Selected" : openTrack ? "In view" : "Locked"}
            {" · "}
            {medalName(medal)}
            {" · best "}
            {row?.bestRace != null ? formatRaceTime(row.bestRace) : "—"}
            {mark ? ` · gold ${formatRaceTime(mark.gold)}` : ""}
          </p>
        </div>
        <div className="dock-stats">
          <p className="dock-meta">{def.difficulty}</p>
          <p className="dock-meta">Lap best {row?.bestLap != null ? formatRaceTime(row.bestLap) : "—"}</p>
        </div>
        <div className="stack picker-actions">
          {flow === "race" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canStart}
              onClick={() => {
                pick(def.id);
                useGame.getState().beginRace();
              }}
            >
              Start race
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => open("title", "browse")}>
              Done
            </button>
          )}
          {flow === "race" ? (
            <button type="button" className="btn" onClick={() => open("cars", "race")}>
              Change car
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => open("title", "browse")}>
            Menu
          </button>
        </div>
      </footer>
    </section>
  );
}
