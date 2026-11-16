// Made-up sponsors for the arena (3.4). Every brand here is invented for Skyline Smash; Solar Sparks and
// Ventra keep their own image boards (ads.ts). Each tournament gets its own mix: a presenting sponsor,
// the brands on its boards, an official shuttle, a scoreboard style and a court look.

export type Mark = 'wing' | 'dot' | 'chevron' | 'wave' | 'star' | 'ring' | 'bolt' | 'leaf' | 'drop' | 'peak';
export interface Brand { id: string; name: string; line: string; bg: string; fg: string; mark: Mark }

/** Racket and kit makers: players wear one of these (shown on the pre-match screen and their shirts' trim). */
export const KIT_BRANDS: Brand[] = [
  { id: 'kestrel', name: 'KESTREL', line: 'Rackets', bg: '#101820', fg: '#f2c14e', mark: 'wing' },
  { id: 'arcwing', name: 'ARCWING', line: 'Badminton', bg: '#e8edf2', fg: '#c8102e', mark: 'chevron' },
  { id: 'featherline', name: 'Featherline', line: 'Since 1962', bg: '#0e3b2e', fg: '#e9f5ec', mark: 'leaf' },
  { id: 'novalite', name: 'NOVALITE', line: 'Carbon rackets', bg: '#1a1240', fg: '#7fe0ff', mark: 'star' },
  { id: 'swiftcourt', name: 'SwiftCourt', line: 'Court shoes', bg: '#ff6a2b', fg: '#ffffff', mark: 'bolt' },
];

export const SHUTTLE_BRANDS: Brand[] = [
  { id: 'plumecraft', name: 'PLUMECRAFT', line: 'Official shuttle', bg: '#f7f4ec', fg: '#24324a', mark: 'drop' },
  { id: 'corkcrest', name: 'Corkcrest', line: 'Official shuttle', bg: '#2b1d12', fg: '#f1d9b0', mark: 'ring' },
];

/** Everyone else who buys boards. */
export const SPONSOR_BRANDS: Brand[] = [
  { id: 'harborline', name: 'Harborline Bank', line: 'Banking', bg: '#0b2a4a', fg: '#ffffff', mark: 'wave' },
  { id: 'zephyr', name: 'ZEPHYR AIR', line: 'Fly further', bg: '#ffffff', fg: '#1f5fbf', mark: 'wing' },
  { id: 'lumo', name: 'LUMO', line: 'Energy drink', bg: '#c6ff3d', fg: '#111111', mark: 'bolt' },
  { id: 'pacifica', name: 'Pacifica Mobile', line: '5G everywhere', bg: '#7b2cbf', fg: '#ffffff', mark: 'dot' },
  { id: 'monsoon', name: 'Monsoon Tea', line: 'Brewed slow', bg: '#1d4d2b', fg: '#f4e3b2', mark: 'leaf' },
  { id: 'tidewater', name: 'TIDEWATER', line: 'Insurance', bg: '#e9f1f7', fg: '#0d3b66', mark: 'drop' },
  { id: 'orbis', name: 'ORBIS MOTORS', line: 'Electric', bg: '#121212', fg: '#e5e5e5', mark: 'ring' },
  { id: 'kinetic', name: 'Kinetic Water', line: 'Hydration', bg: '#00a6d6', fg: '#ffffff', mark: 'drop' },
  { id: 'summit', name: 'SUMMIT', line: 'Hotels & resorts', bg: '#3b2a1a', fg: '#e8c48a', mark: 'peak' },
  { id: 'halo', name: 'Halo Electronics', line: 'Screens', bg: '#f2f2f2', fg: '#e63946', mark: 'ring' },
];

export const ALL_BRANDS = [...KIT_BRANDS, ...SHUTTLE_BRANDS, ...SPONSOR_BRANDS];

export type ScoreboardStyle = 'broadcast' | 'classic' | 'minimal' | 'light';

export interface EventLook {
  /** A key of COURT_THEMES. */
  court: string;
  scoreboard: ScoreboardStyle;
  /** "presented by" (none at the Olympics and World Championships). */
  presenter: Brand | null;
  /** Painted boards around the court (Solar Sparks and Ventra keep their own). */
  boards: Brand[];
  shuttle: Brand;
  /** Officials' blazers. */
  blazer: string;
  /** The scoreboard's accent colour. */
  accent: string;
}

const h32 = (s: string) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
const pick = <T,>(a: T[], seed: number) => a[seed % a.length];

/** Exhibition matches (CPU, practice, online): the usual green court and a fixed set of boards. */
export const DEFAULT_LOOK: EventLook = {
  court: 'green', scoreboard: 'broadcast', presenter: null,
  boards: [SPONSOR_BRANDS[1], KIT_BRANDS[0], SPONSOR_BRANDS[2], KIT_BRANDS[1], SPONSOR_BRANDS[7], SHUTTLE_BRANDS[0]],
  shuttle: SHUTTLE_BRANDS[0], blazer: '#26344d', accent: '#ffd166',
};

/** Each tournament's look, the same every year. tier: S100 … OLYMPICS or CLUB. */
export function eventLook(id: string, tier: string): EventLook {
  const k = h32(id);
  const others = [...SPONSOR_BRANDS].sort((a, b) => h32(id + a.id) - h32(id + b.id));
  const kit = [...KIT_BRANDS].sort((a, b) => h32(id + b.id) - h32(id + a.id));
  const boards = [others[1], kit[0], others[2], kit[1], others[3], others[4]];
  const shuttle = pick(SHUTTLE_BRANDS, k >>> 3);
  if (tier === 'OLYMPICS') return { court: 'purple', scoreboard: 'light', presenter: null, boards: [others[0], others[1], others[2], others[3], others[4], others[5]], shuttle, blazer: '#3b2a6b', accent: '#b69cff' };
  if (tier === 'WORLDS') return { court: 'worlds', scoreboard: 'classic', presenter: null, boards, shuttle, blazer: '#1b2a4a', accent: '#ffd166' };
  if (tier === 'WTF') return { court: 'finals', scoreboard: 'broadcast', presenter: others[0], boards, shuttle, blazer: '#1a1a1a', accent: '#e8c25a' };
  if (tier === 'CLUB') return { court: 'club', scoreboard: 'minimal', presenter: null, boards: [others[0], kit[0], others[1], kit[1], others[2], others[3]], shuttle, blazer: '#3a3f47', accent: '#cfe38a' };
  const courts = ['green', 'green', 'blue', 'teal', 'crimson', 'blue'];
  const boardsStyles: ScoreboardStyle[] = tier === 'S1000' || tier === 'S750' ? ['broadcast', 'broadcast', 'classic'] : tier === 'S500' ? ['broadcast', 'classic', 'minimal'] : ['minimal', 'classic', 'broadcast'];
  const blazers = ['#26344d', '#2b2f36', '#4a1f2a', '#1f3b34'];
  const accents = ['#ffd166', '#7fd1ff', '#ff8fa3', '#9be58a'];
  return {
    court: pick(courts, k), scoreboard: pick(boardsStyles, k >>> 5),
    presenter: tier === 'S100' ? null : others[0], boards, shuttle,
    blazer: pick(blazers, k >>> 7), accent: pick(accents, k >>> 9),
  };
}

/** A player's racket and kit maker, the same in every match. */
export const kitBrandOf = (playerId: string) => KIT_BRANDS[h32(`kit:${playerId}`) % KIT_BRANDS.length];

// ── Board artwork: each brand drawn once as a wide banner (mark on the left, name and strapline). ──
export interface BrandBanner { banner: HTMLCanvasElement; bg: string }
const banners = new Map<string, BrandBanner>();

function drawMark(c: CanvasRenderingContext2D, m: Mark, x: number, y: number, r: number, color: string) {
  c.fillStyle = color; c.strokeStyle = color; c.lineWidth = r * 0.22; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  switch (m) {
    case 'wing': c.moveTo(x - r, y + r * 0.5); c.quadraticCurveTo(x - r * 0.1, y - r * 1.1, x + r, y - r * 0.6); c.quadraticCurveTo(x + r * 0.1, y - r * 0.1, x - r, y + r * 0.5); c.fill(); break;
    case 'dot': c.arc(x, y, r * 0.75, 0, Math.PI * 2); c.fill(); break;
    case 'ring': c.arc(x, y, r * 0.7, 0, Math.PI * 2); c.stroke(); break;
    case 'chevron': c.moveTo(x - r, y - r * 0.6); c.lineTo(x, y + r * 0.5); c.lineTo(x + r, y - r * 0.6); c.stroke(); break;
    case 'wave': c.moveTo(x - r, y); c.bezierCurveTo(x - r * 0.5, y - r * 0.8, x, y + r * 0.8, x + r * 0.5, y); c.quadraticCurveTo(x + r * 0.75, y - r * 0.4, x + r, y); c.stroke(); break;
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.4 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); break;
    case 'bolt': c.moveTo(x + r * 0.2, y - r); c.lineTo(x - r * 0.55, y + r * 0.1); c.lineTo(x, y + r * 0.1); c.lineTo(x - r * 0.2, y + r); c.lineTo(x + r * 0.55, y - r * 0.1); c.lineTo(x, y - r * 0.1); c.closePath(); c.fill(); break;
    case 'leaf': c.ellipse(x, y, r * 0.45, r, Math.PI / 4, 0, Math.PI * 2); c.fill(); break;
    case 'drop': c.moveTo(x, y - r); c.quadraticCurveTo(x + r * 0.8, y + r * 0.1, x, y + r * 0.8); c.quadraticCurveTo(x - r * 0.8, y + r * 0.1, x, y - r); c.fill(); break;
    case 'peak': c.moveTo(x - r, y + r * 0.7); c.lineTo(x - r * 0.2, y - r * 0.8); c.lineTo(x + r * 0.2, y - r * 0.1); c.lineTo(x + r * 0.5, y - r * 0.5); c.lineTo(x + r, y + r * 0.7); c.closePath(); c.fill(); break;
  }
}

export function brandBanner(b: Brand): BrandBanner {
  const hit = banners.get(b.id);
  if (hit) return hit;
  const W = 900, H = 170, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = b.bg; c.fillRect(0, 0, W, H);
  c.font = `800 ${H * 0.44}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const nameW = c.measureText(b.name).width;
  c.font = `600 ${H * 0.17}px ui-sans-serif, system-ui, sans-serif`;
  const lineW = c.measureText(b.line.toUpperCase()).width;
  const markR = H * 0.3, total = markR * 2 + 26 + Math.max(nameW, lineW), x0 = (W - Math.min(total, W - 40)) / 2;
  drawMark(c, b.mark, x0 + markR, H * 0.47, markR, b.fg);
  c.fillStyle = b.fg; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.font = `800 ${H * 0.44}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  c.fillText(b.name, x0 + markR * 2 + 26, H * 0.6, W - x0 - markR * 2 - 46);
  c.globalAlpha = 0.75;
  c.font = `600 ${H * 0.17}px ui-sans-serif, system-ui, sans-serif`;
  c.fillText(b.line.toUpperCase(), x0 + markR * 2 + 28, H * 0.84, W - x0 - markR * 2 - 46);
  const out = { banner: cv, bg: b.bg };
  banners.set(b.id, out);
  return out;
}
