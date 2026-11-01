import { useMemo } from "react";
import { buildCourse } from "@/game/track";
import { themeFor } from "@/game/track-def";
import type { VehicleDefinition } from "@/game/vehicle-def";

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Lightweight SVG previews avoid opening a WebGL context for every garage card. */
export function CarStage({ def }: { def: VehicleDefinition }) {
  const paint = hex(def.color);
  const wide = def.body.body[0] > 1.18;
  const long = def.body.body[2] > 1.12;
  const low = def.body.body[1] < 0.9;
  const number = def.id === "vector" ? "27" : def.id === "vanta" ? "44" : def.id === "surge" ? "08" : "13";
  return (
    <div className="stage car-stage" aria-hidden="true">
      <svg viewBox="0 0 360 220" role="presentation">
        <defs>
          <linearGradient id={`paint-${def.id}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f5fbff" stopOpacity=".76" />
            <stop offset=".38" stopColor={paint} />
            <stop offset="1" stopColor="#101820" />
          </linearGradient>
          <radialGradient id={`glow-${def.id}`}>
            <stop stopColor={paint} stopOpacity=".55" />
            <stop offset="1" stopColor={paint} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="180" cy="177" rx="127" ry="25" fill={`url(#glow-${def.id})`} />
        <ellipse cx="180" cy="183" rx="104" ry="12" fill="#05080d" opacity=".84" />
        <g transform="translate(0 2)">
          <path d={`M${wide ? 54 : 62} 143 77 112q10-13 35-17l${long ? 20 : 22}-31q8-10 24-12h${low ? 42 : 45}q18 2 28 14l22 29q26 6 38 18l13 31-13 20H76z`} fill={`url(#paint-${def.id})`} stroke="#d8f8ff" strokeOpacity=".62" strokeWidth="2" />
          <path d={`m${wide ? 138 : 143} 97 17-28q4-6 14-7h${low ? 31 : 27}q10 1 15 9l18 27z`} fill="#101d2a" stroke="#b9efff" strokeOpacity=".62" strokeWidth="2" />
          <path d="m176 64-12 32m36-33 13 34" stroke="#b9efff" strokeOpacity=".32" />
          <path d="m87 124 34-8m152 8 29 9" stroke="#fff" strokeOpacity=".6" strokeWidth="3" />
          <path d="m75 146 34 2m142 0 39-4" stroke="#ff4d75" strokeWidth="5" strokeLinecap="round" />
          <path d="m131 165 18 1m66 0 18-1" stroke="#2ee6ff" strokeWidth="3" strokeLinecap="round" />
          <path d="M84 132v20m192-20v20" stroke="#111820" strokeWidth="16" strokeLinecap="round" />
          <path d="M59 157h242" stroke="#0b0e13" strokeWidth="5" />
          <path d="M112 119h18m102 0h18" stroke={paint} strokeWidth="7" strokeLinecap="round" opacity=".86" />
          <path d="M108 175h144" stroke="#d8f8ff" strokeOpacity=".55" strokeWidth="2" />
          <text x="180" y="151" fill="#f8fbff" fontSize="14" fontFamily="Arial Narrow, Arial, sans-serif" fontWeight="900" textAnchor="middle">{number}</text>
        </g>
      </svg>
    </div>
  );
}

export function TrackStage({ id }: { id: string }) {
  const { points, sky, edge } = useMemo(() => {
    const track = buildCourse(id);
    const theme = themeFor(track.themeId);
    const xs = track.samples.map((sample) => sample.x);
    const zs = track.samples.map((sample) => sample.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const scale = Math.min(300 / Math.max(1, maxX - minX), 172 / Math.max(1, maxZ - minZ));
    const offsetX = (360 - (maxX - minX) * scale) / 2;
    const offsetY = (220 - (maxZ - minZ) * scale) / 2;
    const pts = track.samples
      .filter((_, index) => index % Math.max(1, Math.floor(track.samples.length / 240)) === 0)
      .map((sample) => `${(offsetX + (sample.x - minX) * scale).toFixed(1)},${(offsetY + (sample.z - minZ) * scale).toFixed(1)}`)
      .join(" ");
    return { points: pts, sky: hex(theme.sky), edge: hex(theme.edgeL) };
  }, [id]);
  return (
    <div className="stage track-stage" aria-hidden="true">
      <svg viewBox="0 0 360 220" role="presentation" style={{ background: sky }}>
        <defs>
          <radialGradient id={`track-glow-${id}`}>
            <stop stopColor={edge} stopOpacity=".3" />
            <stop offset="1" stopColor={edge} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="180" cy="110" rx="155" ry="112" fill={`url(#track-glow-${id})`} />
        <polyline points={points} fill="none" stroke="#03070b" strokeWidth="31" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={points} fill="none" stroke={edge} strokeWidth="25" strokeLinejoin="round" strokeLinecap="round" opacity=".84" />
        <polyline points={points} fill="none" stroke="#29333d" strokeWidth="20" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={points} fill="none" stroke="#9eb7c7" strokeWidth="1.5" strokeDasharray="7 7" strokeLinejoin="round" opacity=".68" />
        <circle cx={points.split(" ")[0]?.split(",")[0]} cy={points.split(" ")[0]?.split(",")[1]} r="5" fill="#fff" />
      </svg>
    </div>
  );
}
