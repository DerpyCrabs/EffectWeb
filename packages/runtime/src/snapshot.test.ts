import { describe, expect, it } from 'vitest';
import { Cause, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { modelOwner } from './owner.js';
import { program } from './program.js';

describe('published snapshot protection', () => {
  it('rejects nested mutation through retained inputs and subscriber values', () => {
    const initial = { items: [{ text: 'before' }] };
    const app = modelOwner(initial, { checkSnapshots: true });
    try {
      expect(() => initial.items.push({ text: 'bad' })).toThrow(TypeError);
      expect(() => {
        initial.items[0]!.text = 'bad';
      }).toThrow(TypeError);
      const seen: string[] = [];
      app.source.subscribe((model) => {
        expect(() => {
          // @ts-expect-error Runtime guard also catches untyped mutations.
          model.items[0]!.text = 'bad';
        }).toThrow(TypeError);
        seen.push(model.items[0]!.text);
      });
      app.edit('items', (items) => items.map((item) => ({ ...item, text: 'after' })));
      expect(seen).toEqual(['after']);
      expect(app.read().items[0]!.text).toBe('after');
    } finally {
      app.dispose();
    }
  });

  it('protects reducers before they can mutate and keeps the last valid model', () => {
    const app = program({
      initial: { values: [1] },
      checkSnapshots: true,
      update(model, _message: void) {
        // @ts-expect-error Runtime guard also catches untyped mutations.
        model.values.push(2);
        return { model };
      },
    });
    try {
      expect(() => app.send()).toThrow(TypeError);
      expect(app.model().values).toEqual([1]);
    } finally {
      app.dispose();
    }
  });

  it('protects staged transaction reads and rolls back a mutation failure', () => {
    const app = modelOwner({ record: { count: 0 } }, { checkSnapshots: true });
    try {
      expect(() =>
        app.transaction(() => {
          app.patch({ record: { count: 1 } });
          // @ts-expect-error Runtime guard also catches untyped mutations.
          app.read().record.count++;
        }),
      ).toThrow(TypeError);
      expect(app.read().record.count).toBe(0);
      app.patch({ record: { count: 2 } });
      expect(app.read().record.count).toBe(2);
    } finally {
      app.dispose();
    }
  });

  it('preserves opaque instances and never evaluates getters', () => {
    class Service {
      count = 0;
      increment() {
        this.count++;
      }
    }
    const service = new Service();
    const effect = Effect.succeed(1);
    let reads = 0;
    const record = {
      get current() {
        reads++;
        return 1;
      },
    };
    const app = modelOwner({ service, effect, record }, { checkSnapshots: true });
    try {
      expect(reads).toBe(0);
      app.read().service.increment();
      expect(service.count).toBe(1);
      expect(app.read().effect).toBe(effect);
      expect(Effect.runSync(effect)).toBe(1);
      expect(Object.isFrozen(service)).toBe(false);
    } finally {
      app.dispose();
    }
  });

  it('checks symbol fields, cyclic data, and already frozen parent records', () => {
    const key = Symbol('data');
    const child = { value: 1 };
    const root: { self?: unknown; [key]: typeof child } = { [key]: child };
    root.self = root;
    Object.freeze(root);
    const app = modelOwner(root, { checkSnapshots: true });
    try {
      expect(() => {
        child.value = 2;
      }).toThrow(TypeError);
    } finally {
      app.dispose();
    }
  });

  it('protects query successes and retained data after failed refreshes', () => {
    const success = AsyncResult.success([{ text: 'cached' }]);
    const failure = AsyncResult.failure(Cause.fail('offline'), {
      previousSuccess: Option.some(AsyncResult.success([{ text: 'retained' }])),
    });
    const app = modelOwner({ success, failure }, { checkSnapshots: true });
    try {
      expect(() => {
        success.value[0]!.text = 'bad';
      }).toThrow(TypeError);
      const retained = Option.getOrThrow(AsyncResult.value(failure));
      expect(() => {
        retained[0]!.text = 'bad';
      }).toThrow(TypeError);
      expect(app.read().success).toBe(success);
      expect(app.read().failure).toBe(failure);
      expect(Object.isFrozen(success)).toBe(false);
    } finally {
      app.dispose();
    }
  });

  it('does not freeze input when checks are disabled and preserves shared references', () => {
    const data = { nested: { count: 0 } };
    const app = modelOwner(data, { checkSnapshots: false });
    try {
      expect(Object.isFrozen(data)).toBe(false);
      app.patch({ nested: data.nested });
      expect(app.read()).toBe(data);
      app.edit('nested', (nested) => nested);
      expect(app.read()).toBe(data);
    } finally {
      app.dispose();
    }
  });
});
