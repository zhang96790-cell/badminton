// Guided tour of the start screen: dims everything except one thing at a time and explains it.

export interface TourStep {
  /** CSS selector of what to spotlight. Steps whose target isn't visible are skipped. */
  target: string;
  title: string;
  text: string;
  /** Set the screen up first (open or close a drawer). */
  before?: () => void;
}

export class Tour {
  private i = 0;
  private open = false;
  private root: HTMLElement;
  private spot: HTMLElement;
  private card: HTMLElement;
  private raf = 0;

  constructor(private steps: TourStep[], private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'tour';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="tour-spot"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourText">
        <p class="tour-step" id="tourStep"></p>
        <h3 id="tourTitle"></h3>
        <p id="tourText"></p>
        <div class="tour-actions">
          <button type="button" class="tour-skip">Skip tour</button>
          <span></span>
          <button type="button" class="tour-back">Back</button>
          <button type="button" class="tour-next primary">Next</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.spot = this.root.querySelector('.tour-spot')!;
    this.card = this.root.querySelector('.tour-card')!;
    this.root.querySelector('.tour-skip')!.addEventListener('click', () => this.close());
    this.root.querySelector('.tour-back')!.addEventListener('click', () => this.go(-1));
    this.root.querySelector('.tour-next')!.addEventListener('click', () => this.go(1));
    // Keys go to the tour while it's open, not to the menu or game behind it.
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape') this.close();
      else if (e.code === 'ArrowRight' || e.code === 'Enter') this.go(1);
      else if (e.code === 'ArrowLeft') this.go(-1);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true });
  }

  get isOpen(): boolean { return this.open; }

  start() {
    this.open = true;
    this.root.hidden = false;
    this.i = -1;
    this.go(1);
    const follow = () => { this.place(); if (this.open) this.raf = requestAnimationFrame(follow); };
    this.raf = requestAnimationFrame(follow);
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.onClose();
  }

  private visible(sel: string): HTMLElement | null {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? el : null;
  }

  /** Move by `dir`, skipping steps whose target can't be seen (e.g. on a phone). */
  private go(dir: 1 | -1) {
    let i = this.i;
    for (;;) {
      i += dir;
      if (i >= this.steps.length) { this.close(); return; }
      if (i < 0) return;
      this.steps[i].before?.();
      if (this.visible(this.steps[i].target)) break;
    }
    this.i = i;
    const s = this.steps[i], last = i === this.steps.length - 1;
    this.root.querySelector('#tourStep')!.textContent = `${i + 1} of ${this.steps.length}`;
    this.root.querySelector('#tourTitle')!.textContent = s.title;
    this.root.querySelector('#tourText')!.textContent = s.text;
    (this.root.querySelector('.tour-back') as HTMLButtonElement).disabled = i === 0;
    const next = this.root.querySelector('.tour-next') as HTMLButtonElement;
    next.textContent = last ? 'Done' : 'Next';
    next.focus({ preventScroll: true });
    // On small screens the board scrolls: bring the target into view (the spotlight follows it).
    document.querySelector(s.target)?.scrollIntoView({ block: 'center' });
    this.place();
  }

  /** Spotlight the target and put the card beside it, wherever there's room. */
  private place() {
    const el = document.querySelector<HTMLElement>(this.steps[this.i]?.target ?? '');
    if (!el) return;
    const r = el.getBoundingClientRect(), pad = 8, gap = 14, vw = innerWidth, vh = innerHeight;
    Object.assign(this.spot.style, {
      left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
    });
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    let x: number, y: number;
    if (r.bottom + gap + ch < vh) { x = r.left; y = r.bottom + gap + pad; }
    else if (r.top - gap - ch > 0) { x = r.left; y = r.top - gap - pad - ch; }
    else if (r.right + gap + cw < vw) { x = r.right + gap + pad; y = r.top; }
    else if (r.left - gap - cw > 0) { x = r.left - gap - pad - cw; y = r.top; }
    else { x = (vw - cw) / 2; y = vh - ch - 16; }
    this.card.style.left = `${Math.max(12, Math.min(vw - cw - 12, x))}px`;
    this.card.style.top = `${Math.max(12, Math.min(vh - ch - 12, y))}px`;
  }
}
