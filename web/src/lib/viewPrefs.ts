import { useCallback, useState } from 'react';

// How the conversation thread is drawn: its zoom and how wide it may get.
// Global and persisted like `showThinking`/`expandTools` — a reading
// preference belongs to the reader, not to one session.

const ZOOM_KEY = 'threadZoom';
const WIDTH_KEY = 'threadWidth';

export const ZOOM_DEFAULT = 100;
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

/** 0 means no limit — the thread fills the scroller ("Full"). */
export const WIDTH_FULL = 0;
/** 896 px: `max-w-4xl`, the only width the viewer ever had. */
export const WIDTH_DEFAULT = 896;
export const WIDTH_MIN = 480;
export const WIDTH_MAX = 4000;

export const WIDTH_PRESETS: Array<{ label: string; px: number }> = [
  { label: 'Narrow', px: 720 },
  { label: 'Normal', px: WIDTH_DEFAULT },
  { label: 'Wide', px: 1200 },
  { label: 'Extra', px: 1600 },
  { label: 'Full', px: WIDTH_FULL },
];

const LADDER = WIDTH_PRESETS.map((p) => p.px)
  .filter((px) => px !== WIDTH_FULL)
  .sort((a, b) => a - b);

export function widthLabel(px: number): string {
  return WIDTH_PRESETS.find((p) => p.px === px)?.label ?? 'Custom';
}

/**
 * The next preset up or down from wherever the width is now — a typed-in custom
 * value included, which lands on the neighbouring preset rather than snapping
 * back to where it came from. Full sits at the top of the ladder.
 */
export function stepWidth(px: number, dir: 1 | -1): number {
  if (px === WIDTH_FULL) return dir === -1 ? LADDER[LADDER.length - 1] : WIDTH_FULL;
  if (dir === 1) return LADDER.find((p) => p > px) ?? WIDTH_FULL;
  return [...LADDER].reverse().find((p) => p < px) ?? LADDER[0];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function readNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface ViewPrefs {
  zoom: number;
  width: number;
  setZoom: (n: number) => void;
  setWidth: (n: number) => void;
  stepZoomBy: (dir: 1 | -1) => void;
  stepWidthBy: (dir: 1 | -1) => void;
  reset: () => void;
  /** Nothing is off its default — the button must not claim otherwise. */
  isDefault: boolean;
}

export function useViewPrefs(): ViewPrefs {
  const [zoom, setZoomState] = useState(() => clamp(readNumber(ZOOM_KEY, ZOOM_DEFAULT), ZOOM_MIN, ZOOM_MAX));
  const [width, setWidthState] = useState(() => {
    const n = readNumber(WIDTH_KEY, WIDTH_DEFAULT);
    return n === WIDTH_FULL ? WIDTH_FULL : clamp(n, WIDTH_MIN, WIDTH_MAX);
  });

  const setZoom = useCallback((n: number) => {
    const next = clamp(Math.round(n), ZOOM_MIN, ZOOM_MAX);
    localStorage.setItem(ZOOM_KEY, String(next));
    setZoomState(next);
  }, []);
  const setWidth = useCallback((n: number) => {
    const next = n === WIDTH_FULL ? WIDTH_FULL : clamp(Math.round(n), WIDTH_MIN, WIDTH_MAX);
    localStorage.setItem(WIDTH_KEY, String(next));
    setWidthState(next);
  }, []);

  return {
    zoom,
    width,
    setZoom,
    setWidth,
    stepZoomBy: (dir) => setZoom(Math.round(zoom / ZOOM_STEP) * ZOOM_STEP + dir * ZOOM_STEP),
    stepWidthBy: (dir) => setWidth(stepWidth(width, dir)),
    reset: () => {
      setZoom(ZOOM_DEFAULT);
      setWidth(WIDTH_DEFAULT);
    },
    isDefault: zoom === ZOOM_DEFAULT && width === WIDTH_DEFAULT,
  };
}
