/** Internal completion accounting, including reentrant acquisition before a fiber is available. */
export class Settlement {
  private pending = 0;
  private waiters: Array<() => void> = [];
  begin(): () => void {
    this.pending++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--this.pending) return;
      for (const done of this.waiters) done();
      this.waiters.length = 0;
    };
  }
  wait(): Promise<void> {
    return new Promise((done) => {
      if (this.pending) this.waiters.push(done);
      else done();
    });
  }
}
