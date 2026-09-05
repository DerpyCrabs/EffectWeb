import { Cause, Effect } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { describe, expect, it } from 'vitest';
import { compiled, Scope } from './dom.js';
import { available } from './resource.js';
import { taskComponent, taskControls, type TaskMessage, type TaskModel } from './task.js';

interface Props {
  id: string;
  run: (text: string, suffix: string) => Effect.Effect<string, unknown>;
}
type Fields = { text: string };
function mountTask(props: Props, policy: 'drop' | 'replace' = 'drop') {
  let child!: Scope<TaskModel<Props, Fields, string>, TaskMessage<Fields, string>>;
  const scope = new Scope<Props, never>(props, () => {});
  const task = taskComponent<Props, Fields, string, string>({
    init: () => ({ text: 'initial' }),
    identity: (props) => props.id,
    task: { policy, run: (model, suffix) => model.props.run(model.text, suffix) },
    view: compiled((scope) => {
      child = scope;
    }),
  });
  task.build(scope, {} as Node, null);
  return { scope, controls: taskControls(child.send), model: () => child.value };
}

function deferred() {
  let complete!: (value: string) => void;
  let canceled = false;
  const effect = Effect.callback<string>((resume) => {
    complete = (value) => resume(Effect.succeed(value));
    return Effect.sync(() => {
      canceled = true;
    });
  });
  return {
    effect,
    complete: (value: string) => complete(value),
    ready: () => Boolean(complete),
    canceled: () => canceled,
  };
}

describe('component tasks', () => {
  it.each(['failure', 'defect', 'throw'] as const)('settles %s and allows retry', async (kind) => {
    const problem = new Error(kind);
    let fail = true;
    const task = mountTask({
      id: 'first',
      run: () => {
        if (!fail) return Effect.succeed('recovered');
        if (kind === 'throw') throw problem;
        return kind === 'failure' ? Effect.fail(problem) : Effect.die(problem);
      },
    });
    task.controls.run('');
    await expect.poll(() => AsyncResult.isFailure(task.model().task)).toBe(true);
    const result = task.model().task;
    expect(result.waiting).toBe(false);
    if (AsyncResult.isFailure(result)) expect(Cause.squash(result.cause)).toBe(problem);
    fail = false;
    task.controls.run('');
    await expect.poll(() => available(task.model().task)).toBe('recovered');
    task.scope.dispose();
  });

  it('drops concurrent submits and captures fields once per accepted run', async () => {
    const pending = deferred();
    const calls: string[] = [];
    const task = mountTask({
      id: 'first',
      run: (text, suffix) => {
        calls.push(text + suffix);
        return pending.effect;
      },
    });
    task.controls.run('!');
    task.controls.patch({ text: 'edited' });
    task.controls.run('?');
    await expect.poll(pending.ready).toBe(true);
    expect(calls).toEqual(['initial!']);
    expect(task.model().text).toBe('edited');
    pending.complete('first');
    await expect.poll(() => available(task.model().task)).toBe('first');
    task.scope.dispose();
  });

  it('replaces work without letting its late completion overwrite the current task', async () => {
    const pending = deferred();
    const task = mountTask(
      {
        id: 'first',
        run: (_text, input) => (input === 'slow' ? pending.effect : Effect.succeed('new')),
      },
      'replace',
    );
    task.controls.run('slow');
    await expect.poll(pending.ready).toBe(true);
    task.controls.run('fast');
    await expect.poll(() => available(task.model().task)).toBe('new');
    await expect.poll(pending.canceled).toBe(true);
    pending.complete('stale');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(available(task.model().task)).toBe('new');
    task.scope.dispose();
  });

  it('retains fields for the same identity and resets and cancels when identity changes', async () => {
    const pending = deferred();
    const initial: Props = { id: 'first', run: () => pending.effect };
    const task = mountTask(initial);
    task.controls.patch({ text: 'draft' });
    task.scope.set({ ...initial });
    expect(task.model().text).toBe('draft');
    task.controls.run('');
    await expect.poll(pending.ready).toBe(true);
    task.scope.set({ id: 'second', run: () => Effect.succeed('second') });
    expect(task.model().text).toBe('initial');
    expect(AsyncResult.isInitial(task.model().task)).toBe(true);
    await expect.poll(pending.canceled).toBe(true);
    pending.complete('stale');
    task.controls.run('');
    await expect.poll(() => available(task.model().task)).toBe('second');
    task.scope.dispose();
  });

  it.each(['cancel', 'dispose'] as const)('%s interrupts active work', async (action) => {
    const pending = deferred();
    const task = mountTask({ id: 'first', run: () => pending.effect });
    task.controls.run('');
    await expect.poll(pending.ready).toBe(true);
    if (action === 'cancel') {
      task.controls.cancel();
      expect(AsyncResult.isInitial(task.model().task)).toBe(true);
    } else task.scope.dispose();
    await expect.poll(pending.canceled).toBe(true);
    task.scope.dispose();
  });
});
