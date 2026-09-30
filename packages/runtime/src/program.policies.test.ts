import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { commandSlot, program, type Command, type TaskPolicy } from './program.js';
import { controlledEffect } from './testing.js';

// Random interleavings of admissions, completions and cancellations across every policy,
// checked against a small model of what each policy promises. A failing seed is printed.
const policies: readonly TaskPolicy[] = ['replace', 'drop', 'queue', 'latest-queued', 'parallel'];
type Step =
  | { kind: 'admit'; slot: number; policy: TaskPolicy; name: string }
  | { kind: 'settle'; slot: number }
  | { kind: 'cancel'; slot: number };
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
    const slots = [commandSlot('a'), commandSlot('b')];
    const started: string[] = [];
    const discarded: string[] = [];
    const finished: string[] = [];
    const pending = new Map<string, ReturnType<typeof controlledEffect<string>>>();
    // What the program is allowed to have active or pending per slot.
    const model = new Map<number, { active: string[]; pending: string[] }>();
    let counter = 0;
    const source = program<number, Message>({
      initial: 0,
      update: (state, message) => {
        if ('done' in message) {
          finished.push(message.done);
          return { model: state + 1 };
        }
        const commands: Command<Message>[] = [];
        const cancel: ReturnType<typeof commandSlot>[] = [];
        for (const step of message.steps) {
          if (step.kind === 'cancel') cancel.push(slots[step.slot]!);
          if (step.kind !== 'admit') continue;
          const { name } = step;
          const request = controlledEffect<string>();
          pending.set(name, request);
          commands.push({
            slot: slots[step.slot]!,
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
    const admit = (slot: number, policy: TaskPolicy, name: string) => {
      const group = model.get(slot) ?? { active: [], pending: [] };
      if (policy === 'drop' && (group.active.length || group.pending.length)) {
        model.set(slot, group);
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
      model.set(slot, group);
    };
    for (let round = 0; round < 12; round++) {
      const steps: Step[] = [];
      const count = 1 + next(3);
      for (let index = 0; index < count; index++) {
        const slot = next(2);
        const roll = next(10);
        if (roll < 6)
          steps.push({
            kind: 'admit',
            slot,
            policy: policies[next(policies.length)]!,
            name: `${slot}:${counter++}`,
          });
        else if (roll < 9) steps.push({ kind: 'settle', slot });
        else steps.push({ kind: 'cancel', slot });
      }
      // Apply the same steps to the model in the order the program applies a transition:
      // every cancellation first, then admissions in order.
      for (const step of steps)
        if (step.kind === 'cancel') model.set(step.slot, { active: [], pending: [] });
      for (const step of steps) if (step.kind === 'admit') admit(step.slot, step.policy, step.name);
      source.send({ steps: steps.filter((step) => step.kind !== 'settle') });
      for (const step of steps) {
        if (step.kind !== 'settle') continue;
        const group = model.get(step.slot);
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
      for (const [slot, group] of model) {
        const activeSlots = source.activeSlots();
        expect(activeSlots.includes(slots[slot]!), `slot ${slot} active`).toBe(
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
    expect(source.activeSlots()).toEqual([]);
  },
);
