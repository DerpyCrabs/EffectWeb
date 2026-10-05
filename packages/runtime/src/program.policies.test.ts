import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { createProgram, type OwnedCommand, type RunPolicy } from './program.js';
import { controlledEffect } from './testing.js';

// Random interleavings of admissions, completions and cancellations across every policy,
// checked against a small model of what each policy promises. A failing seed is printed.
const policies: readonly RunPolicy[] = ['replace', 'drop', 'queue', 'latest-queued', 'parallel'];
type Step =
  | { kind: 'admit'; key: number; policy: RunPolicy; name: string }
  | { kind: 'settle'; key: number }
  | { kind: 'cancel'; key: number };
type Message = { readonly steps: readonly Step[] } | { readonly done: string };

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return (bound: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % bound;
  };
}

it.each(Array.from({ length: 200 }, (_, seed) => seed + 1))(
  'every command starts once or is discarded once, and policies hold (seed %i)',
  async (seed) => {
    const next = random(seed);
    const keys = ['a', 'b'];
    const started: string[] = [];
    const discarded: string[] = [];
    const finished: string[] = [];
    const pending = new Map<string, ReturnType<typeof controlledEffect<string>>>();
    // What the program is allowed to have active or pending per slot.
    const model = new Map<number, { active: string[]; pending: string[] }>();
    let counter = 0;
    const source = createProgram<number, Message>({
      initial: 0,
      update: (state, message) => {
        if ('done' in message) {
          finished.push(message.done);
          return { model: state + 1 };
        }
        const commands: OwnedCommand<Message>[] = [];
        const cancel: string[] = [];
        for (const step of message.steps) {
          if (step.kind === 'cancel') cancel.push(keys[step.key]!);
          if (step.kind !== 'admit') continue;
          const { name } = step;
          const request = controlledEffect<string>();
          pending.set(name, request);
          commands.push({
            key: keys[step.key]!,
            policy: step.policy,
            onDiscard: () => discarded.push(name),
            effect: Effect.suspend(() => {
              started.push(name);
              return request.effect;
            }).pipe(Effect.map((done) => ({ done }))),
          });
        }
        return { model: state, commands, cancel };
      },
    });
    const admit = (key: number, policy: RunPolicy, name: string) => {
      const group = model.get(key) ?? { active: [], pending: [] };
      if (policy === 'drop' && (group.active.length || group.pending.length)) {
        model.set(key, group);
        return;
      }
      if (policy === 'replace') {
        group.active = [];
        group.pending = [];
      }
      if ((policy === 'queue' || policy === 'latest-queued') && group.active.length) {
        if (policy === 'latest-queued') group.pending = [];
        group.pending.push(name);
      } else group.active.push(name);
      model.set(key, group);
    };
    for (let round = 0; round < 12; round++) {
      const steps: Step[] = [];
      const count = 1 + next(3);
      for (let index = 0; index < count; index++) {
        const key = next(2);
        const roll = next(10);
        if (roll < 6)
          steps.push({
            kind: 'admit',
            key,
            policy: policies[next(policies.length)]!,
            name: `${key}:${counter++}`,
          });
        else if (roll < 9) steps.push({ kind: 'settle', key });
        else steps.push({ kind: 'cancel', key });
      }
      // Apply the same steps to the model in the order the program applies a transition:
      // every cancellation first, then admissions in order.
      for (const step of steps)
        if (step.kind === 'cancel') model.set(step.key, { active: [], pending: [] });
      for (const step of steps) if (step.kind === 'admit') admit(step.key, step.policy, step.name);
      source.send({ steps: steps.filter((step) => step.kind !== 'settle') });
      for (const step of steps) {
        if (step.kind !== 'settle') continue;
        const group = model.get(step.key);
        const name = group?.active[0];
        if (!name) continue;
        group!.active.shift();
        // Pending work starts only once the slot has no active work, parallel work included.
        if (!group!.active.length && group!.pending.length)
          group!.active.push(group!.pending.shift()!);
        pending.get(name)!.succeed(name);
        await Effect.runPromise(Effect.sleep(0));
      }
      await Effect.runPromise(Effect.sleep(0));
      for (const [key, group] of model) {
        const activeKeys = source.activeKeys();
        expect(activeKeys.includes(keys[key]!), `slot ${key} active`).toBe(
          group.active.length > 0 || group.pending.length > 0,
        );
      }
      for (const name of started)
        expect(discarded, `${name} both started and discarded`).not.toContain(name);
      expect(new Set(started).size, 'started once').toBe(started.length);
      expect(new Set(discarded).size, 'discarded once').toBe(discarded.length);
    }
    source.dispose();
    await Effect.runPromise(source.awaitStopped());
    for (const request of pending.values()) expect(request.pending()).toBe(0);
    expect(source.activeKeys()).toEqual([]);
  },
);
