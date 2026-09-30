import type { EffectEventRequest } from './effectEvent.js';

type EventResult = void | boolean | EffectEventRequest;
/** Prevention always runs during the native event, before task drop/replace policy is applied. */
export const submit =
  (run: () => EventResult) =>
  (event: Pick<SubmitEvent, 'preventDefault'>): EventResult => {
    event.preventDefault();
    return run();
  };
