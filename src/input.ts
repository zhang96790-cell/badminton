export type Button = 'left' | 'right';

/** Raw keyboard + mouse state. `tapped`/`mouse.pressed`/`mouse.released` are edges since the last endFrame(). */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouse = {
    x: 0,
    y: 0,
    held: new Set<Button>(),
    /** Buttons pressed this frame, with whether Shift/Ctrl was held (trackpad alternatives to right-click). */
    pressed: [] as { button: Button; modified: boolean }[],
    released: [] as Button[],
  };

  constructor(el: HTMLElement) {
    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash']);
    addEventListener('keydown', (e) => {
      if (block.has(e.code) && !(e.target instanceof HTMLButtonElement)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouse.held.clear(); });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    el.addEventListener('mousedown', (e) => {
      const button: Button | null = e.button === 0 ? 'left' : e.button === 2 ? 'right' : null;
      if (!button) return;
      this.mouse.held.add(button);
      this.mouse.pressed.push({ button, modified: e.shiftKey || e.ctrlKey });
    });
    addEventListener('mouseup', (e) => {
      const button: Button | null = e.button === 0 ? 'left' : e.button === 2 ? 'right' : null;
      if (!button || !this.mouse.held.has(button)) return;
      this.mouse.held.delete(button);
      this.mouse.released.push(button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  held(codes: readonly string[]): boolean { return codes.some((c) => this.down.has(c)); }
  tapped(codes: readonly string[]): boolean { return codes.some((c) => this.pressed.has(c)); }

  endFrame() {
    this.pressed.clear();
    this.mouse.pressed = [];
    this.mouse.released = [];
  }
}
