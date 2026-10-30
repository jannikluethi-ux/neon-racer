interface Window {
  __controlsTest?: {
    getYaw: () => number;
    getSpeed: () => number;
    setKeys: (codes: string[]) => void;
  };
}
