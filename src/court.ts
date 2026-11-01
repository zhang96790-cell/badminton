import { COURT } from './config';
import type { Side, V2 } from './math';

/** Net tape height at x: 1.55 m at the posts, sagging to 1.524 m at the centre. */
export function netHeightAt(x: number): number {
  const t = Math.min(1, (x / COURT.postX) ** 2);
  return COURT.netHeightCentre + (COURT.netHeightPost - COURT.netHeightCentre) * t;
}

export interface Rect { xMin: number; xMax: number; yMin: number; yMax: number }

/**
 * Singles court on `side`, to the outer edges of its lines. The net end is left open (far away):
 * landing on the wrong side is judged separately, and the net isn't a line.
 */
export function singlesRect(side: Side): Rect {
  const back = side * COURT.halfLength, open = -side * 50;
  return { xMin: -COURT.singlesHalfWidth, xMax: COURT.singlesHalfWidth, yMin: Math.min(back, open), yMax: Math.max(back, open) };
}

/** x sign of a player's right-hand service court (players face the net). */
export const rightCourtSign = (side: Side): number => -side;

/**
 * Singles service court the receiver must be served into: from the short service line to the back
 * boundary line, between the centre line (shared, so it's in) and the singles sideline.
 */
export function singlesServiceBox(receiverSide: Side, rightCourt: boolean): Rect {
  const sx = rightCourt ? rightCourtSign(receiverSide) : -rightCourtSign(receiverSide);
  const x1 = sx * COURT.singlesHalfWidth, x0 = -sx * (COURT.lineWidth / 2);
  const y0 = receiverSide * COURT.shortServiceLine, y1 = receiverSide * COURT.halfLength;
  return { xMin: Math.min(x0, x1), xMax: Math.max(x0, x1), yMin: Math.min(y0, y1), yMax: Math.max(y0, y1) };
}

/** Positive = inside by that much, negative = outside by that much (for the footprint's centre). */
export function signedInside(p: V2, r: Rect): number {
  const dx = Math.max(r.xMin - p.x, 0, p.x - r.xMax);
  const dy = Math.max(r.yMin - p.y, 0, p.y - r.yMax);
  if (dx > 0 || dy > 0) return -Math.hypot(dx, dy);
  return Math.min(p.x - r.xMin, r.xMax - p.x, p.y - r.yMin, r.yMax - p.y);
}

/** In if any part of the cork's footprint touches the area or its lines. */
export const isIn = (p: V2, r: Rect) => signedInside(p, r) >= -COURT.footprint;
export const inSinglesHalf = (p: V2, side: Side) => p.y * side > 0 && isIn(p, singlesRect(side));

/** How far outside the singles court a point is (0 if in). */
export function distanceOut(p: V2): number {
  return Math.max(0, -signedInside(p, singlesRect(p.y < 0 ? -1 : 1)));
}

/** Every court line as a rectangle, positioned the way the Laws measure them. */
export function courtLineRects(): Rect[] {
  const { doublesHalfWidth: W, singlesHalfWidth: S, halfLength: L, shortServiceLine: SS, doublesLongServiceLine: DL, lineWidth: lw } = COURT;
  const r: Rect[] = [];
  for (const s of [-1, 1]) {
    const xs = (a: number, b: number) => ({ xMin: Math.min(s * a, s * b), xMax: Math.max(s * a, s * b) });
    const ys = (a: number, b: number) => ({ yMin: Math.min(s * a, s * b), yMax: Math.max(s * a, s * b) });
    r.push({ ...xs(W - lw, W), yMin: -L, yMax: L });
    r.push({ ...xs(S - lw, S), yMin: -L, yMax: L });
    r.push({ xMin: -W, xMax: W, ...ys(L - lw, L) });
    r.push({ xMin: -W, xMax: W, ...ys(DL - lw, DL) });
    r.push({ xMin: -W, xMax: W, ...ys(SS, SS + lw) });
    r.push({ xMin: -lw / 2, xMax: lw / 2, ...ys(SS, L) });
  }
  return r;
}
