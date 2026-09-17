/**
 * What the app is doing while it starts, step by step, with timings, so the first screen shows
 * the real work (waiting for another tab, loading SQLite, opening storage…) instead of one
 * generic line. Pure: the clock is injectable and the UI subscribes through `onChange`.
 */
export type StartupStep =
  | 'lock'
  | 'takeover'
  | 'engine'
  | 'storage'
  | 'schema'
  | 'kb'
  | 'archive'
  | 'backup'
  | 'people'
  | 'genotypes'

export interface StepState {
  id: StartupStep
  startedAt: number
  endedAt: number | null
  /** Numbers for the label, e.g. `{ attempt: 2, of: 10 }` while storage retries. */
  detail?: Record<string, number>
}

export class StartupLog {
  readonly startedAt: number
  private list: StepState[] = []

  constructor(
    private readonly onChange: (steps: StepState[]) => void = () => {},
    private readonly now: () => number = () => performance.now(),
  ) {
    this.startedAt = now()
  }

  get steps(): StepState[] {
    return this.list
  }

  /** Starts a step, or updates its detail if it is already running. */
  begin(id: StartupStep, detail?: Record<string, number>): void {
    const s = this.list.find((x) => x.id === id)
    if (s && s.endedAt === null) this.update(id, { detail })
    else
      this.emit([
        ...this.list.filter((x) => x.id !== id),
        { id, startedAt: this.now(), endedAt: null, detail },
      ])
  }

  end(id: StartupStep): void {
    this.update(id, { endedAt: this.now() })
  }

  async run<T>(id: StartupStep, work: () => Promise<T>): Promise<T> {
    this.begin(id)
    try {
      return await work()
    } finally {
      this.end(id)
    }
  }

  private update(id: StartupStep, patch: Partial<StepState>) {
    this.emit(this.list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  private emit(next: StepState[]) {
    this.list = next
    this.onChange(next)
  }
}

/** '850 ms', '1.3 s', '12 s'. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}
