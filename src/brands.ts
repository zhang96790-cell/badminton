// Companies on the arena boards (3.4, lots more in 3.13). All made up for Skyline Smash: some invented
// outright, some sound-alikes of the big names. Solar Sparks and Ventra keep their own image boards (ads.ts),
// on the two middle boards behind the far baseline. Each tournament gets its own mix of boards, a badminton
// brand it's powered by, an official shuttle, a scoreboard style and a court look, and some carry a title
// sponsor in their name (the Ventra China Open, the Solar Sparks Singapore Open).

export type Mark = 'wing' | 'dot' | 'chevron' | 'wave' | 'star' | 'ring' | 'bolt' | 'leaf' | 'drop' | 'peak';
/** country: a home brand there (career: home-country sponsors; boards: local brands at events there). */
export interface Brand { id: string; name: string; line: string; bg: string; fg: string; mark: Mark; country?: string }

const b = (id: string, name: string, line: string, bg: string, fg: string, mark: Mark, country?: string): Brand => ({ id, name, line, bg, fg, mark, ...(country ? { country } : {}) });

/** Racket and kit makers (4.1: the owner's list). Players wear one of these; Yonax most, then Liming, then Victer. */
export const KIT_BRANDS: Brand[] = [
  b('yonax', 'YONAX', 'Rackets', '#00843d', '#ffffff', 'chevron', 'JPN'),
  b('liming', 'LIMING', 'Badminton', '#d71920', '#ffffff', 'wing', 'CHN'),
  b('victer', 'VICTER', 'Badminton', '#0d0d0d', '#e8b923', 'star', 'TPE'),
  b('mizuna', 'MIZUNA', 'Since 1906', '#001e62', '#ffffff', 'wave', 'JPN'),
  b('kompoo', 'KOMPOO', 'Rackets', '#ffffff', '#e30613', 'bolt', 'CHN'),
  b('hundreds', 'HUNDREDS', 'Badminton', '#111111', '#ffffff', 'ring', 'IND'),
];
/** How often players wear each kit brand (same order as KIT_BRANDS). */
const KIT_WEIGHTS = [40, 22, 18, 8, 6, 6];
/** Which badminton brand powers a tournament: mostly Yonax, some Victer, Liming rarely. */
const POWERED_WEIGHTS: [string, number][] = [['yonax', 70], ['victer', 22], ['liming', 8]];

export const SHUTTLE_BRANDS: Brand[] = [
  b('plumecraft', 'PLUMECRAFT', 'Official shuttle', '#f7f4ec', '#24324a', 'drop'),
  b('corkcrest', 'Corkcrest', 'Official shuttle', '#2b1d12', '#f1d9b0', 'ring'),
  b('aeroplume', 'AEROPLUME', 'Official shuttle', '#e6f4ff', '#004f8c', 'wing'),
];

/** Everyone else who buys boards (4.1: the owner's list, spellings as given, plus local brands). */
export const SPONSOR_BRANDS: Brand[] = [
  // Airlines and hotels
  b('emiratas', 'Emiratas', 'Fly better', '#c8102e', '#ffffff', 'wing', 'UAE'),
  b('cathaypacifec', 'Cathay Pacifec', 'Move beyond', '#006564', '#ffffff', 'wing', 'HKG'),
  b('skylineair', 'Skyline Airlines', 'Fly higher', '#002b5c', '#ffcc00', 'chevron'),
  b('singapura', 'Singapura Airlines', 'A great way to fly', '#1d2c5e', '#f5b335', 'wing', 'SGP'),
  b('airasio', 'AirAsio', 'Now everyone can fly', '#e4002b', '#ffffff', 'wing', 'MAS'),
  b('qantaz', 'Qantaz', 'Spirit of Australia', '#e40000', '#ffffff', 'peak', 'AUS'),
  b('marriot', 'Marriot', 'Hotels', '#3a2b2b', '#e8c48a', 'peak'),
  b('hillton', 'Hillton', 'Hotels & resorts', '#104c97', '#ffffff', 'chevron'),
  b('coralbay', 'Coral Bay', 'Resorts', '#ff7f6e', '#ffffff', 'wave'),
  b('bookly', 'Bookly.com', 'Hotels & homes', '#003580', '#ffffff', 'dot'),
  // Phones, tech and electronics
  b('samsong', 'SAMSONG', 'Galaxy of ideas', '#1428a0', '#ffffff', 'ring', 'KOR'),
  b('apples', 'Apple’s', 'Think different', '#111111', '#f5f5f7', 'leaf'),
  b('daikon', 'DAIKON', 'Air conditioning', '#00a0e9', '#ffffff', 'wave', 'JPN'),
  b('panasomic', 'Panasomic', 'Electronics', '#ffffff', '#0041c0', 'dot', 'JPN'),
  b('pacificmobile', 'Pacific Mobile', '5G everywhere', '#7b2cbf', '#ffffff', 'dot'),
  b('telkomsell', 'Telkomsell', 'Indonesia connected', '#e60012', '#ffffff', 'bolt', 'INA'),
  b('egelectronics', 'EG Electronics', 'Life’s good', '#a50034', '#ffffff', 'ring', 'KOR'),
  b('relyance', 'Relyance', 'Digital life', '#0f3c7b', '#ffffff', 'drop', 'IND'),
  // Banks and insurance
  b('hsbk', 'HSBK', 'The world’s bank', '#ffffff', '#db0011', 'chevron'),
  b('goldenlion', 'Golden Lion', 'Life insurance', '#7a1c1c', '#f2c14e', 'peak'),
  b('maybanc', 'Maybanc', 'Humanising banking', '#ffc600', '#111111', 'ring', 'MAS'),
  b('harbourline', 'Harbourline Bank', 'Banking', '#0b2a4a', '#ffffff', 'wave'),
  b('krungthai', 'Krungthai Banc', 'Banking for Thailand', '#00a6e6', '#ffffff', 'drop', 'THA'),
  b('dbx', 'DBX Bank', 'Live more, bank less', '#ff3333', '#ffffff', 'star', 'SGP'),
  // Cars and fuel
  b('toyoka', 'TOYOKA', 'Let’s go places', '#eb0a1e', '#ffffff', 'ring', 'JPN'),
  b('petronax', 'PETRONAX', 'Energy', '#00a19c', '#ffffff', 'drop', 'MAS'),
  b('bnw', 'BNW', 'Sheer driving joy', '#1c69d4', '#ffffff', 'ring', 'GER'),
  b('daihatsoo', 'Daihatsoo', 'Light you up', '#e60012', '#ffffff', 'chevron', 'JPN'),
  // Drinks
  b('pocara', 'Pocara Sweat', 'Ion supply drink', '#ffffff', '#1c4fa1', 'drop', 'JPN'),
  b('avian', 'Avian', 'Natural spring water', '#f4f8fb', '#e2007a', 'peak', 'FRA'),
  b('pepsi', 'Peps-i', 'Thirsty for more', '#004b93', '#ffffff', 'ring'),
  b('hundredminus', '100-minus', 'Isotonic drink', '#0055a4', '#ffffff', 'bolt', 'MAS'),
  b('mylo', 'MYLO', 'Chocolate malt', '#0b7a2b', '#ffffff', 'star', 'MAS'),
  b('beanstreet', 'Bean Street', 'Coffee', '#4b2e1e', '#f3e1c7', 'leaf'),
  b('gatorush', 'GATORUSH', 'Sports drink', '#f47c20', '#111111', 'bolt'),
  b('singha', 'Singh-a Water', 'Pure drinking water', '#c8102e', '#f2d27a', 'drop', 'THA'),
  b('amula', 'Amula', 'The taste of India', '#e2231a', '#ffffff', 'leaf', 'IND'),
  // Shopping, food and delivery
  b('rolexa', 'ROLEXA', 'Swiss watches', '#006039', '#d4af37', 'star'),
  b('uniqo', 'UNIQO', 'Everyday clothing', '#ff0000', '#ffffff', 'dot', 'JPN'),
  b('grabbit', 'Grabbit', 'Rides & food', '#00b14f', '#ffffff', 'chevron', 'SGP'),
  b('shoppi', 'Shoppi', 'Shop online', '#ee4d2d', '#ffffff', 'dot'),
  b('dhx', 'DHX EXPRESS', 'Worldwide delivery', '#ffcc00', '#d40511', 'chevron', 'GER'),
  b('indomee', 'Indomee', 'Instant noodles', '#e31e24', '#ffd400', 'leaf', 'INA'),
  b('antar', 'ANTAR', 'Keep moving', '#d71920', '#ffffff', 'bolt', 'CHN'),
  b('leggo', 'Leggo', 'Build it', '#f6ec36', '#d01012', 'dot', 'DEN'),
];

export const ALL_BRANDS = [...KIT_BRANDS, ...SHUTTLE_BRANDS, ...SPONSOR_BRANDS];
const BY_ID = new Map(ALL_BRANDS.map((x) => [x.id, x]));
export const brandById = (id: string | undefined) => (id ? BY_ID.get(id) : undefined);

/** 4.2: what a career sponsor gives besides money (airlines, hotels, banks, drinks), or nothing (they pay the most). */
export type SponsorPerk = 'flights' | 'hotels' | 'loans' | 'wins' | 'entry';
const PERKS: Record<SponsorPerk, string[]> = {
  flights: ['emiratas', 'cathaypacifec', 'skylineair', 'singapura', 'airasio', 'qantaz'],
  hotels: ['marriot', 'hillton', 'coralbay', 'bookly'],
  loans: ['hsbk', 'maybanc', 'harbourline', 'krungthai', 'dbx', 'goldenlion'],
  wins: ['pocara', 'avian', 'pepsi', 'hundredminus', 'mylo', 'beanstreet', 'gatorush', 'singha', 'amula'],
  // 4.4: delivery and shopping brands pay part of your tournament costs.
  entry: ['grabbit', 'dhx', 'shoppi', 'uniqo'],
};
export const perkOf = (brandId: string): SponsorPerk | null => (Object.keys(PERKS) as SponsorPerk[]).find((k) => PERKS[k].includes(brandId)) ?? null;
export const PERK_TEXT: Record<SponsorPerk, string> = {
  flights: 'Flights half price',
  hotels: 'Hotels paid for',
  loans: 'Cheaper tour loans (a third of the fee, no yearly interest)',
  wins: 'A bonus for every match you win',
  entry: 'Tournament costs 35% off (travel and hotels)',
};

/** Title sponsors: their name goes in front of the tournament's (a brand id, or one of the two image sponsors). */
const TITLE_SPONSOR: Record<string, string> = {
  china_open: 'Ventra', singapore_open: 'Solar Sparks',
  malaysia_open: 'petronax', india_open: 'toyoka', indonesia_masters: 'daikon', indonesia_open: 'grabbit',
  japan_open: 'panasomic', korea_open: 'samsong', hong_kong_open: 'cathaypacifec', denmark_open: 'victer',
  all_england_open: 'yonax', french_open: 'avian', thailand_open: 'singha', malaysia_masters: 'maybanc',
  china_masters: 'liming', australian_open: 'qantaz', german_open: 'bnw', bwf_world_tour_finals: 'hsbk',
};
const titleBrand = (eventId: string) => BY_ID.get(TITLE_SPONSOR[eventId] ?? '');
/** A tournament's full name, with its title sponsor in front when it has one. */
export function sponsoredName(eventId: string, name: string): string {
  const t = TITLE_SPONSOR[eventId];
  if (!t) return name;
  const brand = BY_ID.get(t);
  const short = brand ? brand.name.replace(/ (Bank|Banc|Air|Airways|Airlines|Motors|Cola|Water|Electronics|Mobile)$/i, '') : t;
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
  /** 4.1: the event's sponsors (their boards repeat around the court). */
  sponsors: Brand[];
  /** 4.1: the crowd: shirt colours (the host's flag colours mixed in) and how full the stands are. */
  crowd: string[];
  density: number;
}

/** 4.1: flag colours of the host countries, for the crowd's shirts. */
const FLAG_COLOURS: Record<string, string[]> = {
  CHN: ['#de2910', '#ffde00'], SGP: ['#ef3340', '#ffffff'], MAS: ['#cc0001', '#010066', '#ffcc00'], IND: ['#ff9933', '#138808', '#ffffff'],
  INA: ['#ce1126', '#ffffff'], JPN: ['#bc002d', '#ffffff'], KOR: ['#cd2e3a', '#0047a0', '#ffffff'], HKG: ['#de2910', '#ffffff'],
  DEN: ['#c8102e', '#ffffff'], ENG: ['#ffffff', '#cf081f'], GBR: ['#012169', '#c8102e', '#ffffff'], FRA: ['#0055a4', '#ffffff', '#ef4135'],
  THA: ['#a51931', '#2d2a4a', '#f4f5f8'], AUS: ['#012169', '#e4002b', '#ffffff'], GER: ['#000000', '#dd0000', '#ffce00'], TPE: ['#fe0000', '#000095'],
  USA: ['#b22234', '#3c3b6e', '#ffffff'], CAN: ['#d80621', '#ffffff'], VIE: ['#da251d', '#ffff00'], PHI: ['#0038a8', '#ce1126', '#fcd116'],
  ESP: ['#aa151b', '#f1bf00'], NED: ['#ae1c28', '#21468b', '#ff7f00'], SUI: ['#d52b1e', '#ffffff'], NZL: ['#012169', '#cc142b'],
  BRA: ['#009c3b', '#ffdf00'], MEX: ['#006847', '#ce1126'], UAE: ['#00732f', '#ff0000', '#000000'], MAC: ['#00785e', '#ffffff'],
};
const NEUTRAL_SHIRTS = ['#d8dbe0', '#56636f', '#2b2f36', '#3d6aa8', '#c9a64a', '#9a3d5c', '#4b8a64', '#7b58a0'];
const DENSITY: Record<string, number> = { CLUB: 0.3, S100: 0.45, S300: 0.55, S500: 0.68, S750: 0.78, S1000: 0.88, WORLDS: 0.9, WTF: 0.92, OLYMPICS: 0.97 };
function crowdOf(host: string | undefined, tier: string): { crowd: string[]; density: number } {
  const flag = (host && FLAG_COLOURS[host]) || [];
  // About half the crowd in the home colours, the rest in anything.
  const crowd = flag.length ? [...flag, ...flag, ...flag, ...NEUTRAL_SHIRTS.slice(0, 6)] : NEUTRAL_SHIRTS;
  return { crowd, density: DENSITY[tier] ?? 0.72 };
}

const h32 = (s: string) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
const pick = <T,>(a: T[], seed: number) => a[seed % a.length];
const shuffled = <T extends Brand>(a: T[], id: string) => [...a].sort((x, y) => h32(id + x.id) - h32(id + y.id));

/** A brand's colour as a hue (0–360), from its background, or its lettering when the board is white or black. */
function hueOf(b: Brand): number {
  const pickHex = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const grey = (c: number[]) => Math.max(...c) - Math.min(...c) < 0.12;
  let c = pickHex(b.bg);
  if (grey(c)) c = pickHex(b.fg);
  if (grey(c)) return -1;
  const [r, g, bl] = c, mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
  const h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: number, b: number) => (a < 0 || b < 0 ? 180 : Math.min(Math.abs(a - b), 360 - Math.abs(a - b)));
const weighted = (list: [string, number][], seed: number) => {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = seed % total;
  for (const [id, w] of list) { if (r < w) return id; r -= w; }
  return list[0][0];
};

/**
 * 4.1: like a real event, a handful of sponsors (about 5): the title sponsor, the badminton brand, the shuttle
 * maker, local brands from the host country, then others. Their boards repeat around the court.
 */
function sponsorsFor(id: string, poweredBy: Brand | null, shuttle: Brand, host?: string): Brand[] {
  const title = titleBrand(id);
  const local = host ? shuffled(SPONSOR_BRANDS.filter((x) => x.country === host), id).slice(0, 2) : [];
  const keep = [title, poweredBy, ...local, shuttle].filter((x, i, a): x is Brand => !!x && a.indexOf(x) === i);
  // 4.2.2: fill up with brands in different colours from the ones already there, so no event is all one colour.
  const out = [...keep];
  for (const x of shuffled(SPONSOR_BRANDS, id)) {
    if (out.length >= 5) break;
    if (keep.includes(x) || x.country) continue;
    if (out.every((y) => hueGap(hueOf(x), hueOf(y)) > 40)) out.push(x);
  }
  for (const x of shuffled(SPONSOR_BRANDS, id)) { if (out.length >= 5) break; if (!out.includes(x) && !x.country) out.push(x); }
  return out;
}
/** 16 side boards from the event's sponsors, repeated (never the same brand on two boards side by side). */
function boardsFor(sponsors: Brand[]): Brand[] {
  const out: Brand[] = [];
  for (let i = 0; out.length < 16; i++) out.push(sponsors[i % sponsors.length]);
  return out;
}

/** Each tournament's look, the same every year. tier: S100 … OLYMPICS or CLUB. */
export function eventLook(id: string, tier: string, host?: string): EventLook {
  const k = h32(id);
  const title = titleBrand(id);
  const shuttle = pick(SHUTTLE_BRANDS, k >>> 3);
  // A badminton title sponsor powers its own event (Victer Denmark Open); otherwise mostly Yonax.
  const poweredBy = tier === 'OLYMPICS' || tier === 'WORLDS' ? null
    : title && KIT_BRANDS.includes(title) ? title : BY_ID.get(weighted(POWERED_WEIGHTS, k >>> 11)) ?? null;
  const sponsors = sponsorsFor(id, poweredBy, shuttle, host);
  const boards = boardsFor(sponsors);
  const cr = crowdOf(host, tier);
  if (tier === 'OLYMPICS') return { court: 'purple', scoreboard: 'light', poweredBy, boards, shuttle, blazer: '#3b2a6b', accent: '#b69cff', sponsors, ...cr };
  if (tier === 'WORLDS') return { court: 'worlds', scoreboard: 'classic', poweredBy, boards, shuttle, blazer: '#1b2a4a', accent: '#ffd166', sponsors, ...cr };
  if (tier === 'WTF') return { court: 'finals', scoreboard: 'broadcast', poweredBy, boards, shuttle, blazer: '#1a1a1a', accent: '#e8c25a', sponsors, ...cr };
  if (tier === 'CLUB') return { court: 'club', scoreboard: 'minimal', poweredBy, boards, shuttle, blazer: '#3a3f47', accent: '#cfe38a', sponsors, ...cr };
  const courts = ['green', 'green', 'blue', 'teal', 'crimson', 'blue'];
  const styles: ScoreboardStyle[] = tier === 'S1000' || tier === 'S750' ? ['broadcast', 'broadcast', 'classic'] : tier === 'S500' ? ['broadcast', 'classic', 'minimal'] : ['minimal', 'classic', 'broadcast'];
  const blazers = ['#26344d', '#2b2f36', '#4a1f2a', '#1f3b34'];
  const accents = ['#ffd166', '#7fd1ff', '#ff8fa3', '#9be58a'];
  return {
    court: pick(courts, k), scoreboard: pick(styles, k >>> 5), poweredBy, boards, shuttle,
    blazer: pick(blazers, k >>> 7), accent: pick(accents, k >>> 9), sponsors, ...cr,
  };
}

/** 4.2: your sponsor's boards go up around the court in your career matches. */
export function withSponsor(look: EventLook, brandId: string | undefined): EventLook {
  const brand = brandById(brandId);
  if (!brand || look.sponsors.includes(brand)) return look;
  const sponsors = [brand, ...look.sponsors].slice(0, 6);
  return { ...look, sponsors, boards: boardsFor(sponsors) };
}

/** Exhibition matches (CPU, practice, online): the usual green court and its own mix of boards. */
export const DEFAULT_LOOK: EventLook = { ...eventLook('exhibition', 'S500'), court: 'green', scoreboard: 'broadcast', poweredBy: null, blazer: '#26344d', accent: '#ffd166' };

/** A player's racket and kit maker, the same in every match. */
export const kitBrandOf = (playerId: string) => BY_ID.get(weighted(KIT_BRANDS.map((x, i) => [x.id, KIT_WEIGHTS[i]] as [string, number]), h32(`kit:${playerId}`)))!;

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
  // 4.2.2: bigger name and logo so the boards read from the camera; the strapline is small underneath.
  c.font = `900 ${H * 0.56}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const nameW = c.measureText(b.name).width;
  const markR = H * 0.34, total = markR * 2 + 24 + nameW, x0 = Math.max(16, (W - Math.min(total, W - 32)) / 2);
  drawMark(c, b.mark, x0 + markR, H * 0.46, markR, b.fg);
  c.fillStyle = b.fg; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.font = `900 ${H * 0.56}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  c.fillText(b.name, x0 + markR * 2 + 24, H * 0.66, W - x0 - markR * 2 - 40);
  c.globalAlpha = 0.7;
  c.font = `700 ${H * 0.13}px ui-sans-serif, system-ui, sans-serif`;
  c.fillText(b.line.toUpperCase(), x0 + markR * 2 + 26, H * 0.88, W - x0 - markR * 2 - 40);
  const out = { banner: cv, bg: b.bg };
  banners.set(b.id, out);
  return out;
}
