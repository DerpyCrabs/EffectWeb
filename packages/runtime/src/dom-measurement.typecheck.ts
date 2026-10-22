import type { DomLifetime } from './dom-measurement.js';
declare const lifetime: DomLifetime;
lifetime.measure({
  read: () => 42,
  write: (value) => {
    value satisfies number;
  },
});
lifetime.measure({
  // @ts-expect-error Measurements must finish reading before writes start.
  read: async () => 42,
  write: () => {},
});
lifetime.measure({
  read: () => 42,
  // @ts-expect-error Async writes escape the owned frame and stale-result guard.
  write: async () => {},
});
