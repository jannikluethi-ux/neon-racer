declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys: (codes: string[]) => void;
      /** Dev-only: park the camera around one car for visual QA stills. */
      setInspect: (spec: InspectSpec) => void;
      clearInspect: () => void;
      carCount: () => number;
      phase: () => string;
      /** Dev-only: park car 0 on the live track for contact stills. */
      placeAt: (arc: number, lat: number) => void;
      trackProbe: () => {
        crest: number;
        uphill: number;
        downhill: number;
        transition: number;
        kerb: number;
        kerbGradient: number;
        half: number;
        length: number;
      };
      setQuality: (quality: "low" | "medium" | "high") => void;
      setDressingVisible: (visible: boolean) => void;
      renderStats: () => {
        calls: number;
        triangles: number;
        geometries: number;
        textures: number;
        programs: number;
        dressingVisible: boolean;
        sceneGeometries: number;
        sceneTextures: number;
      };
    };
  }

  /**
   * Camera orbit used by the visual QA harness. `angle` is radians around the
   * car: 0 = head-on, PI = directly behind, ±PI/2 = side.
   */
  type InspectSpec = {
    car?: number;
    angle?: number;
    dist?: number;
    height?: number;
    look?: number;
    fov?: number;
    /** Hold the simulation still while the camera is parked (default true). */
    freeze?: boolean;
  };
}

export {};
