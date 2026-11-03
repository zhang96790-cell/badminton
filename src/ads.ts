// Advertising boards: the sponsors' logos, laid out as wide banners (icon on the left, name on the
// right) so they fit the long, low boards around the court. Built once from the logo images when the
// game loads; until they're ready the boards keep their painted slogans.

export interface Ad { banner: HTMLCanvasElement; bg: string }
type Box = [number, number, number, number]; // x, y, width, height in the source image

interface Sponsor {
  src: string;
  bg: string;
  icon: Box;
  name: Box;
  /** Turn the logo's faint construction lines into background (keeps only the bright artwork). */
  clean?: boolean;
}

const SPONSORS: Record<'solar' | 'ventra', Sponsor> = {
  solar: { src: '/ads/solar-sparks.png', bg: '#ffffff', icon: [240, 30, 610, 720], name: [100, 765, 880, 110] },
  ventra: { src: '/ads/ventra.png', bg: '#0b0c0f', icon: [180, 10, 430, 915], name: [115, 975, 560, 110], clean: true },
};

export const ads: Partial<Record<keyof typeof SPONSORS, Ad>> = {};

function build(s: Sponsor, img: HTMLImageElement): Ad {
  // The logo, cleaned up if it needs it.
  const src = document.createElement('canvas');
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sx = src.getContext('2d')!;
  sx.drawImage(img, 0, 0);
  if (s.clean) {
    const W = src.width, H = src.height;
    const d = sx.getImageData(0, 0, W, H), p = d.data;
    const lum = (i: number) => Math.max(p[i], p[i + 1], p[i + 2]);
    const grey = (i: number) => lum(i) > 40 && lum(i) < 200;
    // Guide lines run the full width or height: rows and columns that are mostly mid-grey get
    // replaced by their neighbours, which also mends them where they cross the white artwork.
    // (Dashed lines are only partly grey; rows inside the wordmark are left alone, since lettering edges look similar.)
    const guideRow = (y: number) => { if (y >= s.name[1]) return false; let n = 0; for (let x = 0; x < W; x++) if (grey((y * W + x) * 4)) n++; return n > W * 0.15; };
    const guideCol = (x: number) => { let n = 0; for (let y = 0; y < s.name[1]; y++) if (grey((y * W + x) * 4)) n++; return n > s.name[1] * 0.15; };
    // A line's soft edges spill a couple of pixels either side, so patch those too.
    const spread = (hits: boolean[]) => hits.map((_, i) => hits.slice(Math.max(0, i - 2), i + 3).some(Boolean));
    const rows = spread(Array.from({ length: H }, (_, y) => guideRow(y)));
    const cols = spread(Array.from({ length: W }, (_, x) => guideCol(x)));
    for (let y = 0; y < H; y++) {
      if (!rows[y]) continue;
      let from = y - 1;
      while (from > 0 && rows[from]) from--;
      p.copyWithin(y * W * 4, from * W * 4, (from + 1) * W * 4);
    }
    for (let x = 0; x < W; x++) {
      if (!cols[x]) continue;
      let from = x - 1;
      while (from > 0 && cols[from]) from--;
      for (let y = 0; y < s.name[1]; y++) for (let c = 0; c < 4; c++) p[(y * W + x) * 4 + c] = p[(y * W + from) * 4 + c];
    }
    const bg = [0x0b, 0x0c, 0x0f];
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.min(1, Math.max(0, (Math.max(p[i], p[i + 1], p[i + 2]) - 150) / 105));
      for (let c = 0; c < 3; c++) p[i + c] = bg[c] + (255 - bg[c]) * v;
      p[i + 3] = 255;
    }
    sx.putImageData(d, 0, 0);
  }
  // Banner: icon, then the name, on the logo's own background colour.
  const H = 360, pad = 30, iconH = H - 2 * pad, nameH = 120, gap = 44;
  const iconW = (s.icon[2] / s.icon[3]) * iconH, nameW = (s.name[2] / s.name[3]) * nameH;
  const banner = document.createElement('canvas');
  banner.width = Math.round(pad * 2 + iconW + gap + nameW);
  banner.height = H;
  const bx = banner.getContext('2d')!;
  bx.fillStyle = s.bg;
  bx.fillRect(0, 0, banner.width, H);
  bx.drawImage(src, s.icon[0], s.icon[1], s.icon[2], s.icon[3], pad, pad, iconW, iconH);
  bx.drawImage(src, s.name[0], s.name[1], s.name[2], s.name[3], pad + iconW + gap, (H - nameH) / 2, nameW, nameH);
  return { banner, bg: s.bg };
}

for (const [key, s] of Object.entries(SPONSORS) as [keyof typeof SPONSORS, Sponsor][]) {
  const img = new Image();
  img.onload = () => { ads[key] = build(s, img); };
  img.src = s.src;
}
