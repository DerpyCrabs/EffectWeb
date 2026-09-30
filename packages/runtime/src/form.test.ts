import { describe, expect, it } from 'vitest';
import { submit } from './form.js';
import { Effect } from 'effect';
import { effectEvent } from './effectEvent.js';

describe('submit', () => {
  it('prevents every submit synchronously and forwards an owned effect request', () => {
    let prevented = 0;
    const request = effectEvent('drop', () => Effect.void);
    const handle = submit(() => request({} as Event));
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

// @ts-expect-error A cold Effect needs an owned effectEvent, task or command.
submit(() => Effect.void);
// @ts-expect-error A Promise needs adaptation and an owner.
submit(() => Promise.resolve());
