import { describe, expect, it } from 'vitest';
import { inputChecked, inputNumber, inputText, submit } from './form.js';
import { Effect } from 'effect';
import { effectEvent } from './effectEvent.js';

describe('native form event adapters', () => {
  it('captures native values on each invocation without retaining the event', () => {
    const values: string[] = [];
    const input = { value: '途中' };
    const handle = inputText((value) => {
      values.push(value);
    });
    handle({ currentTarget: input });
    input.value = '完了';
    handle({ currentTarget: input });
    expect(values).toEqual(['途中', '完了']);
    const checked: boolean[] = [];
    inputChecked((value) => {
      checked.push(value);
    })({ currentTarget: { checked: false } });
    expect(checked).toEqual([false]);
  });
  it('distinguishes an empty numeric input from zero', () => {
    const values: Array<number | undefined> = [];
    const handle = inputNumber((value) => {
      values.push(value);
    });
    for (const valueAsNumber of [NaN, 0, -2.5]) handle({ currentTarget: { valueAsNumber } });
    expect(values).toEqual([undefined, 0, -2.5]);
  });
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
inputText(() => Effect.void);
// @ts-expect-error A Promise needs adaptation and an owner.
submit(() => Promise.resolve());
