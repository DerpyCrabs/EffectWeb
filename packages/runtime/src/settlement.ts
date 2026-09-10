/** Internal completion accounting, including reentrant acquisition before a fiber is available. */
export class Settlement {
  private pending = 0;
  private waiters = new Set<() => void>();
  begin(): () => void {
    this.pending++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--this.pending) return;
      const waiters = [...this.waiters];
      this.waiters.clear();
      for (const done of waiters) done();
    };
  }
  wait(): Effect.Effect<void> {
    return Effect.callback((resume) => {
      if (!this.pending) return resume(Effect.void);
      const done = () => resume(Effect.void);
      this.waiters.add(done);
      return Effect.sync(() => {
        this.waiters.delete(done);
      });
    });
  }
}
import * as Effect from 'effect/Effect';
