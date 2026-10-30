import {
  CHALLENGES,
  carsMastered,
  challengeLine,
  challengesDone,
  fastestLap,
  fastestRace,
  favoriteCar,
  favoriteTrack,
  goldCount,
} from "@/game/mastery";
import { formatRaceTime } from "@/game/math";
import { useGame } from "@/game/store";
import type { SaveData } from "@/game/save";
import { trackById } from "@/game/track-def";
import { vehicleById } from "@/game/vehicle-def";

function careerSave(): SaveData {
  const s = useGame.getState();
  return {
    saveVersion: 4,
    unlockedVehicles: s.unlockedVehicles,
    unlockedTracks: s.unlockedTracks,
    selectedVehicle: s.selectedVehicle,
    selectedTrack: s.selectedTrack,
    trackRecords: s.records,
    settings: {
      quality: s.quality,
      volume: s.volume,
      steerSens: s.steerSens,
      touch: s.touch,
      difficulty: s.difficulty,
    },
    championship: s.cup,
    trackMastery: s.trackMastery,
    carMastery: s.carMastery,
    career: s.career,
    challenges: s.challenges,
  };
}

export function ProfileScreen() {
  const open = useGame((s) => s.openScreen);
  const career = useGame((s) => s.career);
  const challenges = useGame((s) => s.challenges);
  const save = careerSave();
  const carId = favoriteCar(save);
  const trackId = favoriteTrack(save);
  const lap = fastestLap(save);
  const race = fastestRace(save);
  const done = challengesDone(save);
  return (
    <section className="glass menu-card profile-card">
      <p className="eyebrow">Career</p>
      <h1>PROFILE</h1>
      <div className="stat-grid">
        <p>
          <span>Races</span>
          <strong>{career.races}</strong>
        </p>
        <p>
          <span>Wins</span>
          <strong>{career.wins}</strong>
        </p>
        <p>
          <span>Podiums</span>
          <strong>{career.podiums}</strong>
        </p>
        <p>
          <span>Cups</span>
          <strong>{career.cupsCompleted.length}</strong>
        </p>
        <p>
          <span>Cups won</span>
          <strong>{career.cupsWon.length}</strong>
        </p>
        <p>
          <span>Distance</span>
          <strong>{(career.distance / 1000).toFixed(1)} km</strong>
        </p>
      </div>
      <p className="eyebrow section-label">Mastery</p>
      <p className="best-line">
        Tracks {goldCount(save)} / 4 gold · Cars {carsMastered(save)} / 4 gold
      </p>
      <p className="result-meta">
        Medals {career.golds} gold · {career.silvers} silver · {career.bronzes} bronze
      </p>
      <p className="eyebrow section-label">Records</p>
      <p className="result-meta">
        Fastest lap {lap ? `${formatRaceTime(lap.time)} · ${trackById(lap.trackId).name}${lap.carId ? ` · ${vehicleById(lap.carId).name}` : ""}` : "—"}
      </p>
      <p className="result-meta">
        Best race {race ? `${formatRaceTime(race.time)} · ${trackById(race.trackId).name}${race.carId ? ` · ${vehicleById(race.carId).name}` : ""}` : "—"}
      </p>
      <p className="result-meta">
        Favorite car {carId ? vehicleById(carId).name : "—"} · Favorite track {trackId ? trackById(trackId).name : "—"}
      </p>
      <p className="eyebrow section-label">Challenges {done} / {CHALLENGES.length}</p>
      <ul className="challenge-list">
        {CHALLENGES.map((def) => {
          const row = challenges[def.id];
          const complete = row?.completedAt != null;
          return (
            <li key={def.id} className={complete ? "done" : undefined}>
              <span>
                <strong>{def.name}</strong>
                <small>{def.description}</small>
              </span>
              <em>{complete ? "Complete" : challengeLine(def, row)}</em>
            </li>
          );
        })}
      </ul>
      <div className="stack">
        <button type="button" className="btn" onClick={() => open("title", "browse")}>
          Back
        </button>
      </div>
    </section>
  );
}
