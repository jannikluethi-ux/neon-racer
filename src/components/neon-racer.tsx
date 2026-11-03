import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, House } from "lucide-react";
import { formatRaceTime } from "@/game/math";
import { touch } from "@/game/input";
import { loadSave } from "@/game/save";
import { useGame } from "@/game/store";
import { cupById, currentRound, ordinal, playerStanding, pointsForPlace, racedSeconds, roundsOf, standings } from "@/game/championship";
import { medalName } from "@/game/mastery";
import { CarSelect, CupBrief, CupConfirm, CupDifficulty, CupHome, TitleScreen, TrackSelect } from "@/components/race-screens";
import { ProfileScreen } from "@/components/profile-screen";
import { AI_CARS } from "@/game/tuning";
import { vehicleById } from "@/game/vehicle-def";
import { bindPauseOnHidden } from "@/game/pause-visibility";

function hold(set: (down: boolean) => void) {
  return {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(8);
      set(true);
    },
    onPointerUp: () => set(false),
    onPointerCancel: () => set(false),
    onLostPointerCapture: () => set(false),
  };
}

export function NeonRacer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const phase = useGame((s) => s.phase);
  const course = useGame((s) => s.course);
  const screen = useGame((s) => s.screen);
  const paused = useGame((s) => s.paused);
  const touchMode = useGame((s) => s.touch);
  const [engineError, setEngineError] = useState<string | null>(null);

  // Escape / P toggle pause during a race; auto-pause when the tab is hidden.
  useEffect(() => {
    const racing = phase === "grid" || phase === "countdown" || phase === "racing" || phase === "finishing";
    const onKeyDown = (e: KeyboardEvent) => {
      if (!racing) return;
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        useGame.getState().togglePaused();
      }
    };
    const unbindVisibility = bindPauseOnHidden(document, () => racing);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unbindVisibility();
    };
  }, [phase]);

  useEffect(() => {
    useGame.getState().hydrate(loadSave());
    if (import.meta.env.DEV) {
      const flag = new URLSearchParams(window.location.search).get("unlock");
      if (flag === "0") useGame.getState().setUnlockAll(false);
      else if (flag === "1") useGame.getState().setUnlockAll(true);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cleanup = () => {};
    let cancel = false;
    const showFallback = (msg: string) => { if (!cancel) setEngineError(msg); };
    const onFallback = (ev: Event) => {
      const d = (ev as any).detail;
      showFallback(typeof d === "string" ? d : "Engine error.");
    };
    window.addEventListener("game-fallback", onFallback);
    const onContextLost = (e: Event) => { e.preventDefault(); showFallback("WebGL context lost."); };
    canvas.addEventListener("webglcontextlost", onContextLost);
    void import("@/game/engine").then(({ startGame }) => {
      if (cancel) return;
      try {
        cleanup = startGame(canvas, miniRef.current);
      } catch (err: any) {
        showFallback(err?.message || "Failed to initialize engine.");
      }
    }).catch((err: any) => {
      showFallback(err?.message || "Failed to load engine.");
    });
    return () => {
      cancel = true;
      cleanup();
      window.removeEventListener("game-fallback", onFallback);
      canvas.removeEventListener("webglcontextlost", onContextLost);
    };
  }, []);

  const rootClass = `game-root${touchMode === "on" ? " touch-on" : ""}${touchMode === "off" ? " touch-off" : ""}`;

  return (
    <div className={rootClass} data-phase={phase}>
      <canvas ref={canvasRef} className="game-canvas" />
      {engineError && (
        <div style={{position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",backgroundColor:"rgba(0,0,0,0.85)",color:"#eee",zIndex:2147483647,padding:20,fontFamily:"system-ui,sans-serif",textAlign:"center"}}>
          <div>
            <p style={{marginBottom:"1em"}}>{engineError}</p>
            <button type="button" onClick={() => window.location.reload()} style={{padding:"6px 14px",fontSize:"14px",cursor:"pointer"}}>Retry</button>
          </div>
        </div>
      )}
      {(phase === "menu" && screen === "title") && <TitleScreen />}
      {(phase === "menu" && screen === "cars") && <CarSelect />}
      {(phase === "menu" && screen === "tracks") && <TrackSelect />}
      {(phase === "menu" && screen === "settings") && <SettingsPanel />}
      {(phase === "menu" && screen === "profile") && <ProfileScreen />}
      {(phase === "menu" && screen === "cup") && <CupHome />}
      {(phase === "menu" && screen === "cup-diff") && <CupDifficulty />}
      {(phase === "menu" && screen === "cup-brief") && <CupBrief />}
      {(phase === "grid" || phase === "countdown" || phase === "racing" || phase === "finishing") && <Hud />}
      {paused && (phase === "grid" || phase === "countdown" || phase === "racing" || phase === "finishing") && (
        <div className="pause-overlay" role="dialog" aria-modal="true" aria-label="Paused">
          <div className="glass menu-card pause-card">
            <p className="eyebrow">Race</p>
            <h1>PAUSED</h1>
            <div className="stack">
              <button type="button" className="btn btn-primary" onClick={() => useGame.getState().setPaused(false)}>
                Resume
              </button>
              <button type="button" className="btn" onClick={() => useGame.getState().requestRestart()}>
                <RotateCcw size={18} />
                Restart
              </button>
              <button type="button" className="btn" onClick={() => useGame.getState().requestMenu("title")}>
                <House size={18} />
                Quit
              </button>
            </div>
            <p className="result-meta">Esc / P to resume · controllers: press pause</p>
          </div>
        </div>
      )}
      <MobileRaceHint phase={phase} />
      {(phase === "grid" || phase === "countdown" || phase === "racing" || phase === "finishing") &&
      import.meta.env.DEV ? (
        <Telemetry />
      ) : null}
      {phase === "racing" && course === "pad" ? (
        <p className="pad-legend">Straight · brake · hairpin · slalom · sweeper · power</p>
      ) : null}
      {phase === "results" && <Results />}
      <CupConfirm />
      <canvas ref={miniRef} className="minimap" width={288} height={216} />
      <div className="touch-controls">
        <div className="steer-cluster">
          <button type="button" className="pad" aria-label="Steer left" {...hold((v) => (touch.left = v))}>
            <ChevronLeft />
          </button>
          <button type="button" className="pad" aria-label="Steer right" {...hold((v) => (touch.right = v))}>
            <ChevronRight />
          </button>
        </div>
        <div className="action-cluster">
          <button type="button" className="pad boost" {...hold((v) => (touch.boost = v))}>
            NITRO
          </button>
          <button type="button" className="pad brake" {...hold((v) => (touch.brake = v))}>
            BRAKE
          </button>
          <button type="button" className="pad gas" {...hold((v) => (touch.throttle = v))}>
            GAS
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileRaceHint({ phase }: { phase: string }) {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(orientation: portrait)");
    const update = () => setPortrait(Boolean(query?.matches && (navigator.maxTouchPoints > 0 || "ontouchstart" in window)));
    update();
    query?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    return () => {
      query?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  if (!portrait || !["grid", "countdown", "racing", "finishing"].includes(phase)) return null;
  return (
    <>
      <div className="orientation-scrim" aria-hidden />
      <aside className="orientation-hint" aria-live="polite">
        <span className="orientation-icon" aria-hidden>↔</span>
        <strong>Landscape race mode</strong>
        <small>Rotate your phone for the full track view.</small>
      </aside>
    </>
  );
}

function SettingsPanel() {
  const quality = useGame((s) => s.quality);
  const volume = useGame((s) => s.volume);
  const steerSens = useGame((s) => s.steerSens);
  const touchMode = useGame((s) => s.touch);
  const difficulty = useGame((s) => s.difficulty);
  const patch = useGame((s) => s.patchSettings);

  return (
    <section className="glass settings-card">
      <p className="eyebrow">Tune</p>
      <h2>Settings</h2>
      <label className="field">
        <span className="seg-label">QUALITY</span>
        <div className="seg" role="group" aria-label="Quality">
          {(["low", "medium", "high"] as const).map((level) => (
            <button
              key={level}
              type="button"
              className="btn"
              aria-pressed={quality === level}
              onClick={() => patch({ quality: level })}
            >
              {level}
            </button>
          ))}
        </div>
        <p className="result-meta">Low hides scenery and headlights. High sharpens reflections. Handling stays the same.</p>
      </label>
      <label className="field">
        <span>VOLUME {Math.round(volume * 100)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => patch({ volume: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>STEERING {steerSens.toFixed(2)}</span>
        <input
          type="range"
          min={0.7}
          max={1.35}
          step={0.05}
          value={steerSens}
          onChange={(e) => patch({ steerSens: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span className="seg-label">SINGLE RACE RIVALS</span>
        <div className="seg" role="group" aria-label="Rival difficulty">
          {(["easy", "normal", "hard"] as const).map((level) => (
            <button
              key={level}
              type="button"
              className="btn"
              aria-pressed={difficulty === level}
              onClick={() => patch({ difficulty: level })}
            >
              {level}
            </button>
          ))}
        </div>
      </label>
      <label className="field">
        <span className="seg-label">TOUCH CONTROLS</span>
        <div className="seg" role="group" aria-label="Touch controls">
          {(["auto", "on", "off"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn"
              aria-pressed={touchMode === mode}
              onClick={() => patch({ touch: mode })}
            >
              {mode}
            </button>
          ))}
        </div>
      </label>
      <button type="button" className="btn btn-primary" onClick={() => useGame.getState().openScreen("title", "browse")}>
        Back
      </button>
    </section>
  );
}

function formatGap(seconds: number): string {
  const abs = Math.min(99.9, Math.abs(seconds));
  const sign = seconds >= -0.005 ? "+" : "−";
  return `${sign}${abs.toFixed(2)}`;
}

function formatSectorDelta(seconds: number): string {
  const abs = Math.abs(seconds).toFixed(2);
  if (seconds > 0.005) return `+${abs}s`;
  if (seconds < -0.005) return `−${abs}s`;
  return `±${abs}s`;
}

function GapList() {
  const gaps = useGame((s) => s.gaps);
  const course = useGame((s) => s.course);
  if (course !== "race" || gaps.length === 0) return null;
  return (
    <div className="gap-panel" aria-label="Time gaps. Plus means that rival is ahead.">
      <p className="hud-label">GAPS</p>
      <p className="gap-key">+ ahead · − behind</p>
      {gaps.map((row) => (
        <p key={row.name} className={row.close ? "gap-row close" : "gap-row"}>
          <span className="swatch" style={{ background: row.color }} />
          <span>{row.name}</span>
          <span className="gap-time">{formatGap(row.seconds)}</span>
        </p>
      ))}
    </div>
  );
}

function Hud() {
  const speed = useGame((s) => s.speed);
  const lap = useGame((s) => s.lap);
  const laps = useGame((s) => s.laps);
  const position = useGame((s) => s.position);
  const racers = useGame((s) => s.racers);
  const boost = useGame((s) => s.boost);
  const drift = useGame((s) => s.drift);
  const drifting = useGame((s) => s.drifting);
  const gear = useGame((s) => s.gear);
  const rpm = useGame((s) => s.rpm);
  const raceTime = useGame((s) => s.raceTime);
  const lapTime = useGame((s) => s.lapTime);
  const bestLap = useGame((s) => s.bestLap);
  const sectorIndex = useGame((s) => s.sectorIndex);
  const sectorTime = useGame((s) => s.sectorTime);
  const sectorBest = useGame((s) => s.sectorBest);
  const sectorDelta = useGame((s) => s.sectorDelta);
  const countdownLabel = useGame((s) => s.countdownLabel);
  const banner = useGame((s) => s.banner);
  const wrongWay = useGame((s) => s.wrongWay);
  const phase = useGame((s) => s.phase);
  const course = useGame((s) => s.course);
  const cup = useGame((s) => s.cup);
  const raceContext = useGame((s) => s.raceContext);
  const showClock = phase === "racing" || phase === "finishing" || phase === "results";
  const cupLive = raceContext?.cup && cup && !cup.complete ? cup : null;
  const cupPlace = cupLive && cupLive.results.length > 0 ? playerStanding(cupLive) : null;

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-block">
          <p className="hud-label">POSITION</p>
          <p className="hud-value">{course === "pad" ? "PAD" : `${position} / ${racers}`}</p>
          <div className="instrument">
            <p className="hud-speed">{Math.round(speed)}</p>
            <p className="hud-unit">KM/H · G{gear}</p>
          </div>
          <p className="hud-label nitro-label">NITRO</p>
          <div className="meters">
            <div className="meter" aria-label="Nitro">
              <span style={{ transform: `scaleX(${Math.max(0.02, boost)})` }} />
            </div>
            <div className="meter rpm" aria-label="RPM">
              <span style={{ transform: `scaleX(${Math.max(0.04, rpm)})` }} />
            </div>
            <div className="meter drift" aria-hidden={!drifting}>
              <span style={{ transform: `scaleX(${Math.max(0.02, drift)})` }} />
            </div>
          </div>
          <GapList />
        </div>
        <div className="hud-side">
          <div className="hud-block hud-right">
            <p className="hud-label">LAP</p>
            <p className="hud-value">{course === "pad" ? "—" : `${lap} / ${laps}`}</p>
            <p className="hud-label time-gap">TIME</p>
            <p className="hud-value hud-time">{showClock ? formatRaceTime(raceTime) : "0:00.000"}</p>
            {course === "race" && showClock ? (
              <p className="hud-split">
                LAP {formatRaceTime(lapTime)}
                {bestLap != null ? ` · BEST ${formatRaceTime(bestLap)}` : ""}
              </p>
            ) : null}
            {course === "race" && showClock ? (
              <p className={sectorDelta != null && sectorDelta > 0.05 ? "hud-split sector-behind" : "hud-split sector-ahead"}>
                S{sectorIndex + 1} {formatRaceTime(sectorTime)}
                {sectorBest != null ? ` · ${formatSectorDelta(sectorDelta ?? 0)}` : " · NEW"}
              </p>
            ) : null}
            {cupLive ? (
              <p className="hud-split">
                {(cupById(cupLive.id)?.name ?? "CUP").toUpperCase()} · ROUND {cupLive.round + 1} / {roundsOf(cupLive).length}
                {cupPlace ? ` · ${ordinal(cupPlace.place)}` : ""}
              </p>
            ) : null}
            {raceContext?.daily ? <p className="hud-split daily-live">DAILY RUN · TODAY&apos;S EVENT</p> : null}
          </div>
          <div className="hud-actions">
            <button type="button" className="btn" onClick={() => useGame.getState().requestRestart()}>
              <RotateCcw size={16} />
              Restart
            </button>
            <button type="button" className="btn" onClick={() => useGame.getState().requestMenu()}>
              <House size={16} />
              Menu
            </button>
          </div>
        </div>
      </div>
      {(phase === "grid" || phase === "countdown") && countdownLabel ? (
        <p className="countdown">{countdownLabel}</p>
      ) : null}
      {banner ? <p className="banner">{banner}</p> : null}
      {wrongWay ? <p className="banner warn">WRONG WAY</p> : null}
    </div>
  );
}

function Telemetry() {
  const t = useGame((s) => s.telemetry);
  return (
    <aside className="telemetry" aria-label="Vehicle telemetry">
      <p>SPD {t.speed.toFixed(0)} km/h</p>
      <p>ACC {t.accel.toFixed(1)} m/s²</p>
      <p>
        THR {t.throttle.toFixed(2)} BRK {t.brake.toFixed(2)} STR {t.steer.toFixed(2)}
      </p>
      <p>
        G{t.gear} RPM {Math.round(t.rpm * 100)}%
      </p>
      <p>
        SLIP {((t.slipAngle * 180) / Math.PI).toFixed(1)}°  YAW {t.yawRate.toFixed(2)}
      </p>
      <p>
        LONG {t.longVel.toFixed(1)} LAT {t.latVel.toFixed(1)}
      </p>
      <p>
        SLIP L {t.longSlip.toFixed(2)} F {t.latSlip.toFixed(2)} R {t.rearUse.toFixed(2)}
      </p>
      <p>
        GRIP F {Math.round(t.frontUse * 100)}% R {Math.round(t.rearUse * 100)}% LONG {Math.round(t.longUse * 100)}%
      </p>
      <p>
        LOAD F {t.frontLoad.toFixed(2)} R {t.rearLoad.toFixed(2)}
      </p>
      <p>
        {t.raceState.toUpperCase()} LAP {t.lap} CP {t.checkpoint} P{t.position}
      </p>
      <p>
        {t.driftState === "GRIP" ? "GRIP" : t.driftState}
        {t.boost ? " BOOST" : ""}
        {t.wheelspin > 0.2 ? " SPIN" : ""}
      </p>
      <p>
        {t.aiName || "AI"} {t.aiState} TGT {t.aiTarget.toFixed(0)} BRK {t.aiBrakeDist.toFixed(0)}m
      </p>
      <p>
        THR {t.aiThrottle.toFixed(2)} BRK {t.aiBrake.toFixed(2)} STR {t.aiSteer.toFixed(2)} WP {t.aiNode}
      </p>
      <p>
        ERR {t.aiLineError.toFixed(2)} SLIP {t.aiSlip.toFixed(1)}° F {Math.round(t.aiFront * 100)}% R{" "}
        {Math.round(t.aiRear * 100)}%{t.aiNitro ? " NITRO" : ""}
        {t.falseStart ? " FALSE" : ""}
      </p>
    </aside>
  );
}

function entrantColor(id: string): string {
  if (id === "you") {
    const vehicle = useGame.getState().cup?.vehicleId ?? useGame.getState().selectedVehicle;
    return `#${vehicleById(vehicle).color.toString(16).padStart(6, "0")}`;
  }
  const ai = AI_CARS.find((row) => row.name.toLowerCase() === id);
  return ai ? `#${ai.color.toString(16).padStart(6, "0")}` : "#8aa0b8";
}

function ProgressNote() {
  const summary = useGame((s) => s.lastProgress);
  const personalBest = useGame((s) => s.personalBest);
  if (!summary?.medal) return null;
  return (
    <div className="progress-note">
      <p className={`medal-pop medal-${summary.medal}`}>
        {medalName(summary.medal)} — {summary.reason}
      </p>
      {personalBest ? <p className="best-line pb-flash">New personal best</p> : null}
      {summary.previousRace != null ? <p className="result-meta">Previous best {formatRaceTime(summary.previousRace)}</p> : null}
      <p className="result-meta">
        {summary.trackName} {summary.improvedMedal ? `${medalName(summary.trackMedal)} achieved` : `best ${medalName(summary.trackMedal)}`}
        {" · "}
        {summary.vehicleName} +1 race
        {summary.won ? " · +1 win" : summary.podium ? " · +1 podium" : ""}
      </p>
      {summary.newChallenges.length > 0 ? (
        <p className="best-line">
          {summary.newChallenges
            .slice(0, 3)
            .map((row) => row.name)
            .join(" · ")}
          {summary.newChallenges.length > 3 ? ` · +${summary.newChallenges.length - 3}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function SectorReview() {
  const review = useGame((s) => s.sectorReview);
  if (!review || review.times.length === 0) return null;
  return (
    <div className="sector-review">
      <p className="section-label">SECTOR REVIEW</p>
      {review.biggestLoss ? (
        <p className="best-line sector-loss">
          Biggest time loss: S{review.biggestLoss.index + 1} +{review.biggestLoss.seconds.toFixed(2)}s
        </p>
      ) : (
        <p className="best-line sector-ahead">Every recorded sector matched or beat your previous line.</p>
      )}
      <div className="sector-grid">
        {review.times.map((time, index) => {
          const delta = review.deltas[index];
          return (
            <div key={index} className="sector-chip">
              <span>S{index + 1}</span>
              <strong>{formatRaceTime(time)}</strong>
              <small>{delta == null ? "NEW" : formatSectorDelta(delta)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Results() {
  const results = useGame((s) => s.results);
  const personalBest = useGame((s) => s.personalBest);
  const freshUnlock = useGame((s) => s.freshUnlock);
  const laps = useGame((s) => s.laps);
  const cup = useGame((s) => s.cup);
  const raceContext = useGame((s) => s.raceContext);
  const player = results.find((row) => row.isPlayer);
  const cupRace = raceContext?.cup === true && cup != null;
  const board = cupRace ? standings(cup) : [];
  const mine = cupRace ? playerStanding(cup) : null;
  const earned = player ? pointsForPlace(player.place) : 0;
  const bestLabel =
    personalBest === "both" ? "Best lap and best race" : personalBest === "lap" ? "Best lap" : personalBest === "race" ? "Best race" : "Race over";
  const next = cupRace && !cup.complete ? currentRound(cup) : null;

  if (cupRace && cup.complete) {
    return (
      <section className="glass results-card">
        <p className="eyebrow">{(cupById(cup.id)?.name ?? "Championship")} complete</p>
        <h2>{mine ? `${ordinal(mine.place).toUpperCase()} PLACE` : "Final"}</h2>
        <p className="lede">
          {mine?.name} · {mine?.points ?? 0} points
        </p>
        <p className="best-line">
          {mine?.wins ?? 0} {mine?.wins === 1 ? "win" : "wins"}
          {mine && racedSeconds(mine.time) != null ? ` · ${formatRaceTime(racedSeconds(mine.time)!)} total` : ""}
          {mine?.bestLap != null ? ` · best lap ${formatRaceTime(mine.bestLap)}` : ""}
        </p>
        {freshUnlock ? <p className="best-line">Unlocked: {freshUnlock}.</p> : null}
        <ProgressNote />
        <SectorReview />
        <div>
          {board.map((row) => {
            const total = racedSeconds(row.time);
            return (
              <div key={row.id} className="result-row">
                <span className="swatch" style={{ background: entrantColor(row.id) }} />
                <span>
                  {ordinal(row.place)} {row.name}
                  <span className="result-meta">
                    {row.points} pts · {row.wins} {row.wins === 1 ? "win" : "wins"}
                    {total != null ? ` · ${formatRaceTime(total)}` : ""}
                    {row.bestLap != null ? ` · lap ${formatRaceTime(row.bestLap)}` : ""}
                  </span>
                </span>
                <time>{row.points}</time>
              </div>
            );
          })}
        </div>
        <div className="stack results-actions">
          <button type="button" className="btn btn-primary" onClick={() => useGame.getState().restartChampionship()}>
            Restart championship
          </button>
          <button type="button" className="btn" onClick={() => useGame.getState().requestMenu()}>
            Menu
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="glass results-card">
       <p className="eyebrow">{raceContext?.daily ? "Daily run" : cupRace ? "Race result" : bestLabel}</p>
      <h2>{player ? ordinal(player.place) : "Finish"}</h2>
      {player?.time != null ? <p className="lede">{formatRaceTime(player.time)}</p> : <p className="lede">DNF</p>}
      <p className="best-line">
        {laps} laps
        {player?.bestLap != null ? ` · best lap ${formatRaceTime(player.bestLap)}` : ""}
        {player?.avg != null ? ` · avg ${Math.round(player.avg)} km/h` : ""}
        {player ? ` · nitro ${player.nitro}` : ""}
      </p>
      {raceContext?.daily ? <p className="result-meta">Today&apos;s event is logged to your circuit record.</p> : null}
      {freshUnlock ? <p className="best-line">Unlocked: {freshUnlock}.</p> : null}
      <ProgressNote />
      <SectorReview />
      {cupRace && mine ? (
        <p className="best-line">
          +{earned} championship {earned === 1 ? "point" : "points"} · {ordinal(mine.place)} — {mine.points} pts
        </p>
      ) : null}
      <div>
        {results.map((row) => (
          <div key={row.id || row.name} className="result-row">
            <span className="swatch" style={{ background: row.color }} />
            <span>
              {ordinal(row.place)} {row.name}
              {row.fastest ? " FL" : ""}
              {row.isPlayer && personalBest ? " PB" : ""}
              <span className="result-meta">
                {row.bestLap != null ? `best ${formatRaceTime(row.bestLap)}` : "best —"}
                {row.avg != null ? ` · ${Math.round(row.avg)} km/h` : ""}
                {` · nitro ${row.nitro}`}
              </span>
            </span>
            <time>{row.time == null ? "DNF" : formatRaceTime(row.time)}</time>
          </div>
        ))}
        {cupRace ? <p className="eyebrow standings-label">Championship</p> : null}
        {board.map((row) => (
          <div key={row.id} className="result-row">
            <span className="swatch" style={{ background: entrantColor(row.id) }} />
            <span>
              {ordinal(row.place)} {row.name}
              <span className="result-meta">{row.points} pts</span>
            </span>
            <time>{row.points}</time>
          </div>
        ))}
      </div>
      <div className="stack results-actions">
        {cupRace && next ? (
          <button type="button" className="btn btn-primary" onClick={() => useGame.getState().beginCupRound()}>
            Next — {next.title}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => useGame.getState().requestRestart()}>
            <RotateCcw size={18} />
            Retry
          </button>
        )}
        {cupRace ? (
          <button type="button" className="btn" onClick={() => useGame.getState().askConfirm("quit")}>
            Quit championship
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => useGame.getState().requestMenu("cars")}>
              Change car
            </button>
            <button type="button" className="btn" onClick={() => useGame.getState().requestMenu("tracks")}>
              Change track
            </button>
            <button type="button" className="btn" onClick={() => useGame.getState().requestMenu()}>
              Menu
            </button>
          </>
        )}
      </div>
    </section>
  );
}
