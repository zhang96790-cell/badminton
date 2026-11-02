// Saved highlights: the end of a rally you liked (P after the point), kept on this computer so you can
// watch it again from Social → Highlights. Frames are thinned to 30 a second and rounded to fit storage.
import { REPLAY } from './config';
import type { Frame } from './replay';

export interface Highlight {
  id: string;
  at: number;
  title: string;
  sub: string;
  doubles: boolean;
  landedAt: number | null;
  frames: Frame[];
}

const KEY = 'badminton.highlights';

export function loadHighlights(): Highlight[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Highlight[]; } catch { return []; }
}

/** Save one (newest first). If storage is full, the oldest highlights make room. Returns whether it saved. */
export function saveHighlight(h: Highlight): boolean {
  // Every other frame, a short shuttle trail, and centimetre precision: about a third of the size.
  const frames = h.frames.filter((_, i) => i % 2 === 0).map((f) => ({ ...f, shuttle: { ...f.shuttle, trail: f.shuttle.trail.slice(-4) } }));
  let list = [{ ...h, frames }, ...loadHighlights()].slice(0, REPLAY.highlightsKept);
  const round = (_: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  while (list.length) {
    try { localStorage.setItem(KEY, JSON.stringify(list, round)); return true; } catch { list = list.slice(0, -1); }
  }
  return false;
}

export function deleteHighlight(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify(loadHighlights().filter((h) => h.id !== id))); } catch { /* storage unavailable */ }
}
