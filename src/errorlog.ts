// A small log of errors and freezes, kept on this computer, so a problem can be reported exactly. It's saved
// the moment something happens (so it survives a crash) and shown only through the footer link.
const KEY = 'badminton.errorlog';
const MAX = 30;
export interface LogEntry { at: string; kind: 'error' | 'promise' | 'freeze' | 'note'; text: string; where?: string }

let where = '';
/** Where the player is right now (e.g. "career: new career"), stamped on each entry. */
export function setWhere(w: string) { where = w; }

export function readLog(): LogEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LogEntry[]; } catch { return []; }
}
export function clearLog() { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } }

export function logEntry(kind: LogEntry['kind'], text: string) {
  try {
    const list = readLog();
    list.push({ at: new Date().toISOString(), kind, text: text.slice(0, 500), where: where || undefined });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch { /* storage blocked */ }
  onChange?.();
}
let onChange: (() => void) | null = null;

export function installErrorLog(version: string, changed: () => void) {
  onChange = changed;
  addEventListener('error', (e) => logEntry('error', `${e.message} @ ${e.filename?.split('/').pop()}:${e.lineno}:${e.colno} [${version}]`));
  addEventListener('unhandledrejection', (e) => logEntry('promise', `${String((e.reason as Error)?.message ?? e.reason)} [${version}]`));
  try {
    new PerformanceObserver((l) => {
      for (const t of l.getEntries()) if (t.duration > 1500) logEntry('freeze', `the page froze for ${(t.duration / 1000).toFixed(1)} s [${version}]`);
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* not supported */ }
}

export function logText(): string {
  return readLog().map((x) => `${x.at} ${x.kind}${x.where ? ` (${x.where})` : ''}: ${x.text}`).join('\n') + `\n${navigator.userAgent}`;
}
