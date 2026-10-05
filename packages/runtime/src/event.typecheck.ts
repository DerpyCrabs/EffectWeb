import { Effect } from 'effect';
import type { JSX } from './jsx.js';

// Contextual inference retains the native element type inside a handler returning an Effect.
export const ownedInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
  const value: string = event.currentTarget.value;
  return Effect.succeed(value);
};
export const syncClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => {};
export const conditionalClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => false;
// The native listener owns the returned Effect.
export const effectClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => Effect.void;
const promiseCallback = () => Promise.resolve();
// @ts-expect-error Promise work must be adapted and owned explicitly.
export const floatingPromise: JSX.EventHandler<HTMLButtonElement, MouseEvent> = promiseCallback;
