# EffectWeb website

A statically generated landing page and documentation site built with [Astro](https://astro.build). No UI framework is shipped to the browser: page content is readable without JavaScript, and search, theme and navigation use small native DOM handlers. Astro's client router swaps pages in place and prefetches links on hover, so moving between pages does not reload the document. Markdown-it renders trusted documentation and Shiki highlights code at build time. Inter and JetBrains Mono are served locally.

`website/` is its own npm project (own `package.json`, lock file and `node_modules`), kept out of the workspace so the root's Vite override does not apply to Astro. Run the commands from the repository root:

```sh
npm run install:site   # npm ci inside website/ (CI and Netlify run this first)
npm run dev:site       # http://localhost:4310
npm run test:docs      # typecheck standalone examples marked `ts check` / `tsx check`
npm run build:site     # static output in website/dist
npm run test:site      # validate production pages, assets, links, anchors, search
npm run preview:site   # inspect the static production build on http://localhost:4311
```

Use the T3 Browser for browser verification, following the repository's AGENTS.md. The page supports keyboard search (Cmd/Ctrl+K), copyable code, persistent light/dark themes, and mobile navigation.

## Content

- `content/*.md`: the guides. Page order, titles and sidebar groups are in `lib/content.mjs`.
- `lib/package-docs.mjs`: writes the guides and reference as Markdown into `packages/runtime/docs`, which ships in the `effectweb` package. `npm run build` runs it.
- Code blocks marked `ts check` or `tsx check` are type-checked by `npm run test:docs`. Lines ending in `// @hide` are checked but not shown.
- `lib/api.mjs`: emits TypeScript declarations into ignored `.api/`, parses public exports and generates the seven reference pages. The main package and `@effectweb/query` are grouped by topic; every export must be listed in a category. It does not import or execute application runtime source.
- `lib/reasons.mjs`: one-line explanations of what each API is for. Undocumented callable exports fail generation.
- `src/lib/render.mjs` and `src/lib/data.mjs`: the Markdown pipeline and the pages, search index and version, loaded once per build.
- `src/layouts/Site.astro` and `src/pages/`: the shell, landing page, documentation pages, 404 page, and the `search.json`, `llms.txt` and per-page `index.md` endpoints.
- `src/scripts/site.ts` and `src/styles/style.css`: progressive enhancements and responsive layout. Handlers are bound on `astro:page-load` because the client router swaps pages in place.

The site build does not load the native JSX compiler or require Rust. `npm run build:site` generates the Lucide declarations needed by the API reference before building, so it works after `npm ci` on a clean checkout. Documentation snippet validation does require the compiler build.

The site documents the current workspace, not necessarily the latest npm release. Its version is read from the runtime manifest. The reference keeps upstream type names and supporting local aliases; linked implementation files provide full context.

## Static hosting

Serve `website/dist` with directory-index support (`/docs/tasks/` → `docs/tasks/index.html`) and use `404.html` as the not-found response. No application server, account, external search service, or SPA fallback is required. Deployment is a separate explicit action; building never publishes packages or the site.

### Netlify

Import the `DerpyCrabs/EffectWeb` GitHub repository into Netlify and select `main` as the production branch. Keep the base directory at the repository root. The root `netlify.toml` sets Node 24, runs `npm run build:site && npm run test:site`, and publishes only `website/dist`. Netlify installs dependencies before the build; no build secrets or native compiler are needed. Once connected, pushes to the production branch build and deploy the static site.

For a manual upload, run those same build and check commands locally and upload `website/dist`. Its contents include every HTML page, local fonts, styles, scripts, search data, and the custom `404.html`.

GitHub Pages also supports this output at the domain root (for example, with a custom domain). A project URL such as `derpycrabs.github.io/EffectWeb/` additionally needs base-path support for generated links, assets, and search; the current site uses root-relative URLs.
