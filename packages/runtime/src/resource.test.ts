import { Cause, Effect } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { describe, expect, it } from 'vitest';
import { compiled, Scope } from './dom.js';
import {
  available,
  resourceComponent,
  type ResourceMessage,
  type ResourceModel,
} from './resource.js';

interface Props {
  key: string;
  load: () => Effect.Effect<number, unknown>;
}
function mountResource(props: Props) {
  let child!: Scope<ResourceModel<Props, number>, ResourceMessage>;
  const scope = new Scope<Props, never>(props, () => {});
  const resource = resourceComponent({
    request: (props: Props) => ({ key: props.key, load: props.load }),
    // No DOM is necessary to exercise the real component's model and owned Effects.
    view: compiled((scope) => {
      child = scope;
    }),
  });
  resource.build(scope, {} as Node, null);
  return { scope, model: () => child.value, retry: () => child.send({ type: 'Retry' }) };
}

describe('resource completion', () => {
  it.each(['failure', 'defect', 'throw'] as const)(
    'clears waiting after %s and retains the prior value for retry',
    async (kind) => {
      const problem = new Error(kind);
      let fail = false;
      const resource = mountResource({
        key: 'same',
        load: () => {
          if (!fail) return Effect.succeed(7);
          if (kind === 'throw') throw problem;
          return kind === 'failure' ? Effect.fail(problem) : Effect.die(problem);
        },
      });
      await expect.poll(() => available(resource.model().result)).toBe(7);
      fail = true;
      resource.retry();
      await expect.poll(() => AsyncResult.isFailure(resource.model().result)).toBe(true);
      const result = resource.model().result;
      expect(result.waiting).toBe(false);
      expect(available(result)).toBe(7);
      if (AsyncResult.isFailure(result)) expect(Cause.squash(result.cause)).toBe(problem);
      fail = false;
      resource.retry();
      await expect.poll(() => AsyncResult.isSuccess(resource.model().result)).toBe(true);
      resource.scope.dispose();
    },
  );

  it('cancels the old key and cannot overwrite the replacement resource', async () => {
    let complete!: (value: number) => void;
    let canceled = false;
    const resource = mountResource({
      key: 'first',
      load: () =>
        Effect.callback<number>((resume) => {
          complete = (value) => resume(Effect.succeed(value));
          return Effect.sync(() => {
            canceled = true;
          });
        }),
    });
    await expect.poll(() => typeof complete).toBe('function');
    resource.scope.set({ key: 'second', load: () => Effect.succeed(2) });
    await expect.poll(() => available(resource.model().result)).toBe(2);
    await expect.poll(() => canceled).toBe(true);
    complete(99);
    await new Promise((done) => setTimeout(done, 0));
    expect(available(resource.model().result)).toBe(2);
    resource.scope.dispose();
  });
});
