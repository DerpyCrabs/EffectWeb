import { defineSchema } from '@json-render/core';

/** Flat element-tree schema compatible with upstream catalogs; all component names are consumer-defined. */
export const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref('catalog.components'),
        props: s.propsOf('catalog.components'),
        children: s.array(s.string()),
        visible: { ...s.any(), ...s.optional() },
        on: { ...s.any(), ...s.optional() },
      }),
    ),
    state: { ...s.any(), ...s.optional() },
  }),
  catalog: s.object({
    components: s.map({ props: s.zod(), slots: s.array(s.string()), description: s.string() }),
    actions: s.map({ params: s.zod(), description: s.string() }),
  }),
}));
