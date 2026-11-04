import { useEffect, useMemo, useRef } from "react";
import { buildCourse } from "@/game/track";
import { drawCarModelPreview } from "@/game/car-preview";
import { themeFor } from "@/game/track-def";
import type { VehicleDefinition } from "@/game/vehicle-def";

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Project the current car-model meshes into a 2D canvas for each garage card. */
export function CarStage({ def }: { def: VehicleDefinition }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => drawCarModelPreview(canvas, def);
    render();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(render);
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [def]);

  return (
    <div className="stage car-stage" aria-hidden="true" data-car-id={def.id}>
      <canvas ref={canvasRef} className="car-preview-canvas" />
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
