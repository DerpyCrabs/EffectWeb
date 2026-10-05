import { describe, expect, it } from 'vitest';
import { submit } from './form.js';
import { Effect } from 'effect';

describe('submit', () => {
  it('prevents every submit synchronously and forwards the returned Effect', () => {
    let prevented = 0;
    const handle = submit(() => Effect.void);
    const first = handle({
      preventDefault() {
        prevented++;
      },
    });
    const second = handle({
      preventDefault() {
        prevented++;
      },
    });
    expect(prevented).toBe(2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
  });
});

// Like any JSX handler, an Effect returned from a submit handler is owned by the listener.
submit(() => Effect.void);
// @ts-expect-error A Promise needs adaptation and an owner.
submit(() => Promise.resolve());
