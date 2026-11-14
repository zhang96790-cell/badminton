export type Button = 'left' | 'right';

/** A text box, list or editable area has the keyboard. */
function typing(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(t.type);
  return t instanceof HTMLElement && t.isContentEditable;
}

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
      // Typing in a text box (a name, a room code, a search): those keys are for the box, never the game.
      if (typing(e.target)) return;
      // Never swallow keys meant for a button (Space clicks it).
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
