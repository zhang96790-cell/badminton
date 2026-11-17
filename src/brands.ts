// Companies on the arena boards (3.4, lots more in 3.13). All made up for Skyline Smash: some invented
// outright, some sound-alikes of the big names. Solar Sparks and Ventra keep their own image boards (ads.ts),
// on the two middle boards behind the far baseline. Each tournament gets its own mix of boards, a badminton
// brand it's powered by, an official shuttle, a scoreboard style and a court look, and some carry a title
// sponsor in their name (the Ventra China Open, the Solar Sparks Singapore Open).

export type Mark = 'wing' | 'dot' | 'chevron' | 'wave' | 'star' | 'ring' | 'bolt' | 'leaf' | 'drop' | 'peak';
export interface Brand { id: string; name: string; line: string; bg: string; fg: string; mark: Mark }

const b = (id: string, name: string, line: string, bg: string, fg: string, mark: Mark): Brand => ({ id, name, line, bg, fg, mark });

/** Racket and kit makers: players wear one of these (shown on the pre-match screen and their shirts' trim). */
export const KIT_BRANDS: Brand[] = [
  b('kestrel', 'KESTREL', 'Rackets', '#101820', '#f2c14e', 'wing'),
  b('arcwing', 'ARCWING', 'Badminton', '#e8edf2', '#c8102e', 'chevron'),
  b('featherline', 'Featherline', 'Since 1962', '#0e3b2e', '#e9f5ec', 'leaf'),
  b('novalite', 'NOVALITE', 'Carbon rackets', '#1a1240', '#7fe0ff', 'star'),
  b('swiftcourt', 'SwiftCourt', 'Court shoes', '#ff6a2b', '#ffffff', 'bolt'),
  b('leeming', 'LEEMING', 'Badminton', '#d71920', '#ffffff', 'wing'),
  b('yonax', 'YONAX', 'Rackets', '#0a3d91', '#ffffff', 'chevron'),
  b('victer', 'VICTER', 'Badminton', '#0d0d0d', '#e8b923', 'star'),
];

export const SHUTTLE_BRANDS: Brand[] = [
  b('plumecraft', 'PLUMECRAFT', 'Official shuttle', '#f7f4ec', '#24324a', 'drop'),
  b('corkcrest', 'Corkcrest', 'Official shuttle', '#2b1d12', '#f1d9b0', 'ring'),
  b('aeroplume', 'AEROPLUME', 'Official shuttle', '#e6f4ff', '#004f8c', 'wing'),
];

/** Everyone else who buys boards: companies of every kind. */
export const SPONSOR_BRANDS: Brand[] = [
  // Airlines and travel
  b('zephyr', 'ZEPHYR AIR', 'Fly further', '#ffffff', '#1f5fbf', 'wing'),
  b('emirata', 'Emirata', 'Fly better', '#c8102e', '#ffffff', 'wing'),
  b('cathaypearl', 'Cathay Pearl', 'Airways', '#006564', '#ffffff', 'wing'),
  b('skyward', 'SKYWARD', 'Airlines', '#002b5c', '#ffcc00', 'chevron'),
  b('garudasky', 'Garuda Sky', 'Indonesia’s airline', '#0b4f6c', '#9fe2e8', 'wing'),
  b('bookly', 'Bookly.com', 'Hotels & homes', '#003580', '#ffffff', 'dot'),
  b('summit', 'SUMMIT', 'Hotels & resorts', '#3b2a1a', '#e8c48a', 'peak'),
  b('coralbay', 'Coral Bay', 'Resorts', '#ff7f6e', '#ffffff', 'wave'),
  // Banks, cards and insurance
  b('harborline', 'Harborline Bank', 'Banking', '#0b2a4a', '#ffffff', 'wave'),
  b('hsbk', 'HSBK', 'The world’s bank', '#ffffff', '#db0011', 'chevron'),
  b('maybanc', 'Maybanc', 'Humanising banking', '#ffc600', '#111111', 'ring'),
  b('paystar', 'PayStar', 'Tap to pay', '#1a1f71', '#f7b600', 'star'),
  b('tidewater', 'TIDEWATER', 'Insurance', '#e9f1f7', '#0d3b66', 'drop'),
  b('goldenlion', 'Golden Lion', 'Life insurance', '#7a1c1c', '#f2c14e', 'peak'),
  // Phones, tech and electronics
  b('pacifica', 'Pacifica Mobile', '5G everywhere', '#7b2cbf', '#ffffff', 'dot'),
  b('samsong', 'SAMSONG', 'Galaxy of ideas', '#1428a0', '#ffffff', 'ring'),
  b('hiwave', 'HIWAVE', 'Smartphones', '#cf0a2c', '#ffffff', 'leaf'),
  b('panasomic', 'Panasomic', 'Electronics', '#ffffff', '#0041c0', 'dot'),
  b('halo', 'Halo Electronics', 'Screens', '#f2f2f2', '#e63946', 'ring'),
  b('daikon', 'DAIKON', 'Air conditioning', '#00a0e9', '#ffffff', 'wave'),
  b('telcosel', 'Telcosel', 'Always connected', '#e4002b', '#ffffff', 'bolt'),
  b('pixelcloud', 'PixelCloud', 'Cloud storage', '#0f172a', '#38bdf8', 'drop'),
  // Cars and fuel
  b('toyoka', 'TOYOKA', 'Let’s go places', '#eb0a1e', '#ffffff', 'ring'),
  b('orbis', 'ORBIS MOTORS', 'Electric', '#121212', '#e5e5e5', 'ring'),
  b('hondo', 'HONDO', 'The power of dreams', '#ffffff', '#cc0000', 'chevron'),
  b('petronex', 'PETRONEX', 'Energy', '#00a19c', '#ffffff', 'drop'),
  // Drinks and hydration
  b('lumo', 'LUMO', 'Energy drink', '#c6ff3d', '#111111', 'bolt'),
  b('redbison', 'Red Bison', 'Gives you horns', '#1e2a78', '#ffcc00', 'bolt'),
  b('kinetic', 'Kinetic Water', 'Hydration', '#00a6d6', '#ffffff', 'drop'),
  b('pocara', 'Pocara Sweat', 'Ion supply drink', '#ffffff', '#1c4fa1', 'drop'),
  b('gatorush', 'GATORUSH', 'Sports drink', '#f47c20', '#111111', 'bolt'),
  b('avian', 'Avian', 'Natural spring water', '#f4f8fb', '#e2007a', 'peak'),
  b('fizzco', 'Fizzco Cola', 'Ice cold', '#d00000', '#ffffff', 'wave'),
  b('monsoon', 'Monsoon Tea', 'Brewed slow', '#1d4d2b', '#f4e3b2', 'leaf'),
  b('mylo', 'MYLO', 'Chocolate malt', '#0b7a2b', '#ffffff', 'star'),
  b('beanstreet', 'Bean Street', 'Coffee', '#4b2e1e', '#f3e1c7', 'leaf'),
  // Food, shopping and delivery
  b('lotus', 'Lotus Noodles', 'Ready in 3 minutes', '#ffd400', '#c8102e', 'leaf'),
  b('crunchy', 'Crunchy’s', 'Potato chips', '#e31837', '#ffe600', 'star'),
  b('grabbit', 'Grabbit', 'Rides & food', '#00b14f', '#ffffff', 'chevron'),
  b('shopiq', 'Shopiq', 'Shop online', '#ee4d2d', '#ffffff', 'dot'),
  b('dhx', 'DHX EXPRESS', 'Worldwide delivery', '#ffcc00', '#d40511', 'chevron'),
  b('northstar', 'Northstar', 'Logistics', '#14213d', '#fca311', 'star'),
  b('uniqo', 'UNIQO', 'Everyday clothing', '#ff0000', '#ffffff', 'dot'),
  b('rolexa', 'ROLEXA', 'Swiss watches', '#006039', '#d4af37', 'star'),
  b('freshmart', 'FreshMart', 'Supermarkets', '#2e7d32', '#ffffff', 'leaf'),
  b('sunblock', 'SunGuard', 'SPF 50 sunscreen', '#ffb703', '#023047', 'ring'),
];

export const ALL_BRANDS = [...KIT_BRANDS, ...SHUTTLE_BRANDS, ...SPONSOR_BRANDS];
const BY_ID = new Map(ALL_BRANDS.map((x) => [x.id, x]));

/** Title sponsors: their name goes in front of the tournament's (a brand id, or one of the two image sponsors). */
const TITLE_SPONSOR: Record<string, string> = {
  china_open: 'Ventra', singapore_open: 'Solar Sparks',
  malaysia_open: 'petronex', india_open: 'toyoka', indonesia_masters: 'daikon', indonesia_open: 'grabbit',
  japan_open: 'panasomic', korea_open: 'samsong', hong_kong_open: 'cathaypearl', denmark_open: 'victer',
  all_england_open: 'yonax', french_open: 'avian', thailand_open: 'redbison', malaysia_masters: 'maybanc',
  china_masters: 'leeming', australian_open: 'summit', german_open: 'hondo', bwf_world_tour_finals: 'hsbk',
};
const titleBrand = (eventId: string) => BY_ID.get(TITLE_SPONSOR[eventId] ?? '');
/** A tournament's full name, with its title sponsor in front when it has one. */
export function sponsoredName(eventId: string, name: string): string {
  const t = TITLE_SPONSOR[eventId];
  if (!t) return name;
  const brand = BY_ID.get(t);
  const short = brand ? brand.name.replace(/ (Bank|Air|Airways|Motors|Cola|Water|Electronics|Mobile)$/i, '') : t;
  // Title-case the all-caps brands so the name reads like a name.
  const nice = short === short.toUpperCase() && short.length > 4 ? short[0] + short.slice(1).toLowerCase() : short;
  return name.startsWith(nice) ? name : `${nice} ${name}`;
}

export type ScoreboardStyle = 'broadcast' | 'classic' | 'minimal' | 'light';

export interface EventLook {
  /** A key of COURT_THEMES. */
  court: string;
  scoreboard: ScoreboardStyle;
  /** The badminton brand the event is "powered by" (none at the Olympics and World Championships). */
  poweredBy: Brand | null;
  /** Painted boards around the court: 4 behind the far baseline, then 6 down each side. */
  boards: Brand[];
  shuttle: Brand;
  /** Officials' blazers. */
  blazer: string;
  /** The scoreboard's accent colour. */
  accent: string;
}

const h32 = (s: string) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
const pick = <T,>(a: T[], seed: number) => a[seed % a.length];
const shuffled = <T extends Brand>(a: T[], id: string) => [...a].sort((x, y) => h32(id + x.id) - h32(id + y.id));

/** 16 boards: the title sponsor, the powered-by brand and the shuttle maker, the rest companies of every kind. */
function boardsFor(id: string, poweredBy: Brand | null, shuttle: Brand): Brand[] {
  const title = titleBrand(id);
  const keep = [title, poweredBy, shuttle].filter((x): x is Brand => !!x);
  const rest = shuffled(SPONSOR_BRANDS, id).filter((x) => !keep.includes(x)).slice(0, 16 - keep.length);
  // Spread the event's own brands out: title sponsor on the far boards, the others down the sides.
  const out = [...rest];
  if (title) out.splice(0, 0, title);
  if (poweredBy) out.splice(6, 0, poweredBy);
  out.splice(11, 0, shuttle);
  return out.slice(0, 16);
}

/** Each tournament's look, the same every year. tier: S100 … OLYMPICS or CLUB. */
export function eventLook(id: string, tier: string): EventLook {
  const k = h32(id);
  const title = titleBrand(id);
  const kits = shuffled(KIT_BRANDS, id).filter((x) => x !== title);
  const shuttle = pick(SHUTTLE_BRANDS, k >>> 3);
  const poweredBy = tier === 'OLYMPICS' || tier === 'WORLDS' ? null : kits[0];
  const boards = boardsFor(id, poweredBy, shuttle);
  if (tier === 'OLYMPICS') return { court: 'purple', scoreboard: 'light', poweredBy, boards, shuttle, blazer: '#3b2a6b', accent: '#b69cff' };
  if (tier === 'WORLDS') return { court: 'worlds', scoreboard: 'classic', poweredBy, boards, shuttle, blazer: '#1b2a4a', accent: '#ffd166' };
  if (tier === 'WTF') return { court: 'finals', scoreboard: 'broadcast', poweredBy, boards, shuttle, blazer: '#1a1a1a', accent: '#e8c25a' };
  if (tier === 'CLUB') return { court: 'club', scoreboard: 'minimal', poweredBy, boards, shuttle, blazer: '#3a3f47', accent: '#cfe38a' };
  const courts = ['green', 'green', 'blue', 'teal', 'crimson', 'blue'];
  const styles: ScoreboardStyle[] = tier === 'S1000' || tier === 'S750' ? ['broadcast', 'broadcast', 'classic'] : tier === 'S500' ? ['broadcast', 'classic', 'minimal'] : ['minimal', 'classic', 'broadcast'];
  const blazers = ['#26344d', '#2b2f36', '#4a1f2a', '#1f3b34'];
  const accents = ['#ffd166', '#7fd1ff', '#ff8fa3', '#9be58a'];
  return {
    court: pick(courts, k), scoreboard: pick(styles, k >>> 5), poweredBy, boards, shuttle,
    blazer: pick(blazers, k >>> 7), accent: pick(accents, k >>> 9),
  };
}

/** Exhibition matches (CPU, practice, online): the usual green court and its own mix of boards. */
export const DEFAULT_LOOK: EventLook = { ...eventLook('exhibition', 'S500'), court: 'green', scoreboard: 'broadcast', poweredBy: null, blazer: '#26344d', accent: '#ffd166' };

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
