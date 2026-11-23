import { cupById, CUPS, currentRound, ordinal, playerStanding, roundsOf, standings } from "@/game/championship";
import { dailyEvent } from "@/game/daily";
import { formatRaceTime } from "@/game/math";
import { isTrackUnlocked, SAVE_VERSION } from "@/game/save";
import { useGame } from "@/game/store";
import { AI_CARS } from "@/game/tuning";
import { trackById } from "@/game/track-def";
import { vehicleById } from "@/game/vehicle-def";

export { CarSelect, TrackSelect } from "@/components/showroom-picker";

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

export function TitleScreen({ onShowHowTo }: { onShowHowTo: () => void }) {
  const vehicle = useGame((s) => vehicleById(s.selectedVehicle));
  const track = useGame((s) => trackById(s.selectedTrack));
  const records = useGame((s) => s.records);
  const open = useGame((s) => s.openScreen);
  const row = records[track.id];
  const daily = dailyEvent();
  const dailyTrack = trackById(daily.trackId);
  const dailyCar = vehicleById(daily.vehicleId);
  return (
    <section className="glass menu-card">
      <p className="eyebrow">Night circuit</p>
      <h1>NEON RACER</h1>
      <p className="lede">
        {vehicle.name} on {track.name}. {track.blurb}
      </p>
      <div className="stack">
        <button type="button" className="btn btn-primary" onClick={() => open("cars", "race")}>
          Race
        </button>
        <button type="button" className="btn" onClick={() => useGame.getState().beginDailyRace()}>
          Daily run
        </button>
        <button type="button" className="btn" onClick={() => open("cup", "cup")}>
          Championship
        </button>
        <button type="button" className="btn" onClick={() => open("cars", "browse")}>
          Cars
        </button>
        <button type="button" className="btn" onClick={() => open("tracks", "browse")}>
          Tracks
        </button>
        <button type="button" className="btn" onClick={() => open("profile", "browse")}>
          Profile
        </button>
        <button type="button" className="btn" onClick={() => open("settings", "browse")}>
          Settings
        </button>
        <button type="button" className="btn" onClick={onShowHowTo}>
          How to play
        </button>
        <button type="button" className="btn" onClick={() => useGame.getState().requestPad()}>
          Handling pad
        </button>
      </div>
      <div className="daily-card">
        <div className="daily-head">
          <span className="eyebrow">Daily event · {daily.label}</span>
          <span className="daily-dot" aria-hidden />
        </div>
        <strong>{dailyCar.name} / {dailyTrack.name}</strong>
        <small>One fresh combo each day. Beat your own line and chase a new medal.</small>
      </div>
      <p className="best-line">
        {row?.bestRace != null ? `Best race ${formatRaceTime(row.bestRace)}` : "No race time yet"}
        {row?.bestLap != null ? ` · lap ${formatRaceTime(row.bestLap)}` : ""}
      </p>
      <ul className="key-hints">
        <li>W gas</li>
        <li>S brake</li>
        <li>A / D steer</li>
        <li>Shift / B / N nitro</li>
        <li>Space handbrake</li>
      </ul>
    </section>
  );
}

const DIFFICULTIES = [
  { id: "easy", name: "Easy", blurb: "Relaxed racing." },
  { id: "normal", name: "Normal", blurb: "Recommended." },
  { id: "hard", name: "Hard", blurb: "Aggressive competition." },
] as const;

export function CupHome() {
  const cup = useGame((s) => s.cup);
  const cupPick = useGame((s) => s.cupPick);
  const unlockAll = useGame((s) => s.unlockAll);
  const open = useGame((s) => s.openScreen);
  const ask = useGame((s) => s.askConfirm);
  const pickCup = useGame((s) => s.pickCup);
  const save = snapshot();
  const active = cup != null && !cup.complete;
  const board = cup?.complete ? standings(cup) : null;
  const champion = board?.[0];
  const activeDef = cup ? cupById(cup.id) : undefined;
  return (
    <section className="glass menu-card">
      <p className="eyebrow">Championships</p>
      <h1>NEON CUPS</h1>
      <p className="lede">Same points. One car for the whole cup. Personal records stay separate.</p>
      {active && activeDef ? (
        <p className="best-line">
          {activeDef.name} · round {cup.round + 1} / {roundsOf(cup).length}
          {cup.results.length > 0 ? ` · ${ordinal(playerStanding(cup).place)} · ${playerStanding(cup).points} pts` : ""}
        </p>
      ) : null}
      {champion && activeDef ? (
        <p className="best-line">
          Last {activeDef.name}: {ordinal(champion.place)} {champion.name} · {champion.points} pts
        </p>
      ) : null}
      <div className="stack">
        {CUPS.map((def) => {
          const mine = active && cup?.id === def.id;
          const first = def.rounds[0]!;
          const openCup = unlockAll || isTrackUnlocked(first.trackId, save, false);
          return (
            <button
              key={def.id}
              type="button"
              className="choice plain"
              aria-pressed={cupPick === def.id || mine}
              disabled={!openCup && !mine}
              onClick={() => {
                if (mine) {
                  open("cup-brief", "cup");
                  return;
                }
                pickCup(def.id);
                if (active) ask("replace");
                else open("cars", "cup");
              }}
            >
              <span>
                <strong>{def.name}</strong>
                <small>
                  {mine
                    ? "Resume"
                    : openCup
                      ? def.blurb
                      : "Locked — finish Neon Cup to open Velocity"}
                </small>
              </span>
            </button>
          );
        })}
        {active ? (
          <button type="button" className="btn" onClick={() => ask("quit")}>
            Quit championship
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => open("title", "browse")}>
          Back
        </button>
      </div>
    </section>
  );
}

export function CupDifficulty() {
  const difficulty = useGame((s) => s.difficulty);
  const cupPick = useGame((s) => s.cupPick);
  const patch = useGame((s) => s.patchSettings);
  const open = useGame((s) => s.openScreen);
  const def = cupById(cupPick) ?? CUPS[0]!;
  return (
    <section className="glass menu-card">
      <p className="eyebrow">{def.name}</p>
      <h2>Difficulty</h2>
      <p className="lede">Locked once the cup starts. Rivals change how they drive, not how fast the car is.</p>
      <div className="stack">
        {DIFFICULTIES.map((level) => (
          <button
            key={level.id}
            type="button"
            className="choice plain"
            aria-pressed={difficulty === level.id}
            onClick={() => patch({ difficulty: level.id })}
          >
            <span>
              <strong>{level.name}</strong>
              <small>{level.blurb}</small>
            </span>
          </button>
        ))}
        <button type="button" className="btn btn-primary" onClick={() => open("cup-brief", "cup")}>
          Next — cup
        </button>
        <button type="button" className="btn" onClick={() => open("cars", "cup")}>
          Back
        </button>
      </div>
    </section>
  );
}

export function CupBrief() {
  const cup = useGame((s) => s.cup);
  const cupPick = useGame((s) => s.cupPick);
  const vehicleId = useGame((s) => (s.cup && !s.cup.complete ? s.cup.vehicleId : s.selectedVehicle));
  const difficulty = useGame((s) => (s.cup && !s.cup.complete ? s.cup.difficulty : s.difficulty));
  const open = useGame((s) => s.openScreen);
  const locked = cup != null && !cup.complete;
  const def = cupById(locked && cup ? cup.id : cupPick) ?? CUPS[0]!;
  const rounds = def.rounds;
  const round = locked && cup ? currentRound(cup) : rounds[0]!;
  const car = vehicleById(vehicleId);
  return (
    <section className="glass menu-card">
      <p className="eyebrow">{locked && cup ? `Round ${cup.round + 1} / ${rounds.length}` : "Ready"}</p>
      <h2>{def.name.toUpperCase()}</h2>
      <ol className="cup-list">
        {rounds.map((item, index) => (
          <li key={`${item.trackId}-${index}`} className={locked && cup && index === cup.round ? "cup-now" : undefined}>
            <span>Round {index + 1}</span>
            <strong>{item.title}</strong>
          </li>
        ))}
      </ol>
      <p className="best-line">
        Car {car.name} · {difficulty} · {AI_CARS.map((ai) => ai.name).join(" · ")}
      </p>
      {locked ? <p className="lede">Next up: {round.title}. The car stays {car.name} for the whole cup.</p> : null}
      <div className="stack">
        <button type="button" className="btn btn-primary" onClick={() => useGame.getState().beginCupRound()}>
          {locked && cup.results.length > 0 ? `Race ${round.title}` : "Start"}
        </button>
        {locked ? null : (
          <button type="button" className="btn" onClick={() => open("cars", "cup")}>
            Change car
          </button>
        )}
        {locked ? null : (
          <button type="button" className="btn" onClick={() => open("cup-diff", "cup")}>
            Change difficulty
          </button>
        )}
        {locked ? (
          <button type="button" className="btn" onClick={() => useGame.getState().askConfirm("quit")}>
            Quit championship
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => open("cup", "cup")}>
          Back
        </button>
      </div>
    </section>
  );
}

export function CupConfirm() {
  const confirm = useGame((s) => s.confirm);
  const cup = useGame((s) => s.cup);
  const cupPick = useGame((s) => s.cupPick);
  if (!confirm) return null;
  const replace = confirm === "replace";
  const name = (replace ? cupById(cupPick) : cup ? cupById(cup.id) : undefined)?.name ?? "Championship";
  return (
    <section className="glass results-card confirm-card" role="dialog" aria-labelledby="confirm-title">
      <p className="eyebrow">{name}</p>
      <h2 id="confirm-title">{replace ? "New championship?" : "Quit championship?"}</h2>
      <p className="lede">
        {replace
          ? "The cup in progress will be replaced. Personal records stay."
          : "Progress from this championship will be lost."}
      </p>
      <div className="stack results-actions">
        <button type="button" className="btn" onClick={() => useGame.getState().askConfirm(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            const game = useGame.getState();
            if (replace) game.replaceCup();
            else game.abandonCup();
          }}
        >
          {replace ? "Start new" : "Quit"}
        </button>
      </div>
    </section>
  );
}
