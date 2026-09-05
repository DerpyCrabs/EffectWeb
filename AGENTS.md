# EffectWeb engineering

Use `npm run fmt` for Oxfmt and Rust formatting and `npm run check` for lint/type checks and Clippy. Keep Effect as a peer dependency and snapshots immutable. Runtime and compiler must not import consumer source. Run package smoke tests after changing exports or compiler output. Publishing is an explicit release action; do not publish during tests or builds.
