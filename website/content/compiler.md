`@effectweb/compiler` turns JSX into DOM operations. It is written in Rust and ships as prebuilt binaries, so you do not need Rust installed. The lint rules are in the same package.

## What the compiler does

It converts JSX to calls into the runtime, builds static markup once instead of on every render, and records which outer values an inline `list` callback reads. Development builds add source locations to error messages.

It does not change what your JavaScript means. Function calls, variables, conditions and helpers behave as written. The compiler does not check that views are pure or guess row identity; the lint rules and types cover that.

## Vite

```ts
import { defineConfig } from 'vite';
import { effectweb } from '@effectweb/compiler/vite';

export default defineConfig({ plugins: [effectweb()] });
```

Keep `"jsx": "preserve"` in `tsconfig.json`. The plugin compiles JSX before Vite handles TypeScript, and makes sure linked packages share one copy of `effectweb` and `effect`.

For other build tools, call `compile(source, filename, options)` from `@effectweb/compiler`. It returns code, a source map and diagnostics.

## Other JSX libraries in the same project

Every JSX file is compiled for EffectWeb, unless a comment before its first statement names another runtime:

```tsx
/** @jsxImportSource react */
```

## Lint setup

The preset enables five rules (`valid-view`, `query-key`, `identity`, `render-safety`, `no-hook-names`) as errors.

`.oxlintrc.json`:

```json
{ "extends": ["./node_modules/@effectweb/compiler/dist/oxlint-preset.json"] }
```

In a JavaScript config, spread `effectwebLint` from `@effectweb/compiler/lint-preset` and add your own rules after it.

The rules recognize `view`, `list`, `domMount`, the other helpers only when they are imported from `effectweb` directly. If your project re-exports them from its own module, the rules cannot see them, so import from the package.

## Diagnostic codes

| Code   | Problem                                                               | Fix                                                                                       |
| ------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| EW1001 | `key`, `ref` or `innerHTML` in JSX                                    | `list(entities(rows), render)` for keys, `use={domMount(setup)}` for elements             |
| EW1003 | `send` or `patch` called while rendering                              | Call it from an event handler, a `domMount` setup or a controller                         |
| EW1003 | `new Date()` or `Math.random()` while rendering                       | `observe(clock(…), …)`; create random values in an event or Effect                        |
| EW1003 | `model.rows.sort()` or `.push()` in a view                            | Copy first: `[...model.rows].sort()`                                                      |
| EW1003 | `onClick={async () => { await save(); }}`                             | `onClick={() => save}`, or run it through an owner                                        |
| EW1004 | `update` writes to its model, calls a prop callback or runs an Effect | Return a copied model, and return the work as a command                                   |
| EW1005 | `owner.patch` in `Effect.ensuring` of work run under `replace`        | `owner.task(field, effect, 'replace')`, or `Effect.tap` + `Effect.tapCause`               |
| EW1006 | `makeMount(…)` called as a statement                                  | `yield* makeMount(…)` inside your app's Effect, or `mount(…)` outside Effect              |
| EW2001 | Reading a changing module variable or unknown global in a view        | Put the value in the model                                                                |
| EW2002 | `query({ key: [...], load })`                                         | Remove `key`; every argument is already part of the identity                              |
| EW3001 | Any `.map` callback returning JSX                                     | `list(scalars, render)`, `list(entities(rows), render)` or `list(rows, identity, render)` |
| EW3002 | `domMount(…)` created inside a view                                   | Declare it at module scope                                                                |
| EW3004 | `mapSource`, `clock` or `collection` created inside a view            | Declare it once outside the view                                                          |
| EW3005 | `list(sequence(rows.filter(…)), …)` with inputs                       | `list(entities(rows.filter(…)), …)`                                                       |
| EW3006 | A key built from the row index                                        | Key by a domain field such as `row.id`                                                    |
| EW3007 | A function named `use…`, or a constant holding one                    | Name it as a noun, such as `selectionController`                                          |
