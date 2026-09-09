# EffectWeb engineering

Use `npm run fmt` for Oxfmt and Rust formatting and `npm run check` for lint/type checks and Clippy. Keep Effect as a peer dependency and snapshots immutable. Runtime and compiler must not import consumer source. Run package smoke tests after changing exports or compiler output. Publishing is an explicit release action; do not publish during tests or builds.

## Effect 4 reference

`vendor/effect` is a squashed Git subtree of https://github.com/Effect-TS/effect.git, pinned to `effect@4.0.0-rc.112` (`2600f62f4532026928454dcea8d1c48557b3f942`) to match this workspace's Effect dependency. Consult its source, tests, and migration documentation when implementing Effect APIs. Treat it as an upstream reference: do not edit it for application changes or import from it; keep using the installed `effect` peer dependency. Workspace formatting and linting exclude `vendor/**`.

The [Effect AI article](https://effect.website/blog/effect-ai) provides background, but its older `@effect/ai` examples are not authoritative for Effect 4. Verify APIs against `vendor/effect/packages/effect/src/unstable/ai` and the provider packages in `vendor/effect/packages`.

To update the subtree, choose a release matching the workspace dependency, run `git subtree pull --prefix=vendor/effect https://github.com/Effect-TS/effect.git <release-tag> --squash`, and update the pinned tag and commit above.
