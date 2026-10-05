import type { JSX } from './jsx.js';

/** Prevents the default submission, then runs `run`; a returned Effect runs as from any handler. */
export const submit =
  (run: () => JSX.EventResult) =>
  (event: Pick<SubmitEvent, 'preventDefault'>): JSX.EventResult => {
    event.preventDefault();
    return run();
  };
