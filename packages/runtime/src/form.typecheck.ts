/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement contract. */
import { Context, Effect } from 'effect';
import { defineField, type FieldResult } from './form.js';
import { program } from './program.js';
import { uiRuntime } from './runtime.js';

class Availability extends Context.Service<
  Availability,
  { readonly check: (name: string) => Effect.Effect<string | undefined> }
>()('FieldTypecheck/Availability') {}

export function fieldTypes() {
  const field = defineField({
    id: 'tags',
    parse: (draft: string): FieldResult<{ tags: { name: string }[] }> => ({
      ok: true,
      value: { tags: [{ name: draft }] },
    }),
    validate: (value) => {
      // @ts-expect-error Validators cannot mutate published parsed data.
      // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
      value.tags.push({ name: 'bad' });
      // @ts-expect-error Nested parsed values are readonly.
      value.tags[0]!.name = 'bad';
      return Effect.flatMap(Availability, (service) => service.check(value.tags[0]!.name));
    },
  });
  const initial = field.init('first');
  const runtime = uiRuntime(Context.make(Availability, { check: () => Effect.succeed(undefined) }));
  const source = runtime.program({ initial, update: field.update });
  const published = source.model();
  if (published.parsed.ok) {
    // @ts-expect-error Published field data remains readonly.
    // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
    published.parsed.value.tags.pop();
  }
  const changed = field.update(published, { type: 'Change', draft: 'second' });
  if (changed.model.parsed.ok) {
    // @ts-expect-error Reducer results preserve nested readonly values.
    changed.model.parsed.value.tags[0]!.name = 'bad';
  }
  program({
    initial,
    // @ts-expect-error Validation services must be provided by the owner/runtime.
    update: field.update,
  });
  source.dispose();
}
