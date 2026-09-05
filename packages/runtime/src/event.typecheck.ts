import { Effect } from 'effect';
import { effectEvent } from './effectEvent.js';
import type { JSX } from './jsx.js';

// Contextual inference retains the native element type inside the factory.
export const ownedInput: JSX.EventHandler<HTMLInputElement, InputEvent> = effectEvent(
  'replace',
  (event) => {
    const value: string = event.currentTarget.value;
    return Effect.succeed(value);
  },
);
export const syncClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => {};
export const conditionalClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => false;
// @ts-expect-error A cold Effect requires an explicit owner.
export const floatingEffect: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => Effect.void;
const promiseCallback = () => Promise.resolve();
// @ts-expect-error Promise work must be adapted and owned explicitly.
export const floatingPromise: JSX.EventHandler<HTMLButtonElement, MouseEvent> = promiseCallback;
