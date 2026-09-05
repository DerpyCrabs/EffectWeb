import type { EffectEventRequest } from './effectEvent.js';

type EventResult = void | boolean | EffectEventRequest;
type ValueEvent<T> = { readonly currentTarget: T };

/** Capture native values synchronously; returned Effect requests retain the listener's owner. */
export const inputText =
  (change: (value: string) => EventResult) =>
  (event: ValueEvent<{ readonly value: string }>): EventResult =>
    change(event.currentTarget.value);

export const inputChecked =
  (change: (value: boolean) => EventResult) =>
  (event: ValueEvent<{ readonly checked: boolean }>): EventResult =>
    change(event.currentTarget.checked);

/** Empty and invalid numeric inputs stay absent rather than becoming zero or NaN. */
export const inputNumber =
  (change: (value: number | undefined) => EventResult) =>
  (event: ValueEvent<{ readonly valueAsNumber: number }>): EventResult => {
    const value = event.currentTarget.valueAsNumber;
    return change(Number.isNaN(value) ? undefined : value);
  };

/** Prevention always runs during the native event, before task drop/replace policy is applied. */
export const submit =
  (run: () => EventResult) =>
  (event: Pick<SubmitEvent, 'preventDefault'>): EventResult => {
    event.preventDefault();
    return run();
  };
