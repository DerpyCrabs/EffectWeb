# Releases

Runtime, compiler, and the five native packages use one version. Native packages contain only a binary, package metadata, README, and license. Consumers install the platform package through the compiler's optional dependencies; they do not need Cargo or install scripts.

## Validate a release without publishing

Run the **Release** GitHub Actions workflow manually, leaving `publish` false:

```sh
gh workflow run release.yml -f publish=false
```

It runs CI, builds and tests the native compiler on all five platforms, and creates an `npm-packages` artifact containing seven tarballs. Packaging rejects missing binaries and mismatched versions. No npm credentials are needed for this path.

Linux x64 is built on Ubuntu 22.04; Linux arm64 on Ubuntu 24.04. No musl binaries are provided. macOS builds use macOS 15 runners; Windows uses Windows Server 2022. These are the current tested release environments, not a promise of support for every older OS.

## First publication

The npm package names must exist before their settings can be configured for trusted publishing. An npm maintainer must bootstrap them using an authenticated account with publishing rights and any required two-factor authentication:

1. Download the `npm-packages` artifact from a successful Release run into `artifacts/packages` in the matching checkout.
2. Run `npm login` locally. Never put passwords, OTPs, or npm tokens in this repository.
3. Run `node scripts/publish-release.mjs`. It checks that all seven tarballs exist, publishes native packages first, then `effectweb` and `effectweb-compiler`. Existing versions are skipped so interrupted publication can resume. Check the registry if a name has been claimed since setup.
4. On npm, configure a GitHub Actions trusted publisher for **each of the seven packages** with owner `DerpyCrabs`, repository `EffectWeb`, workflow filename `release.yml`, and environment `npm`. Enable direct `npm publish` in the trusted publisher's allowed actions.

The packages are `effectweb`, `effectweb-compiler`, and `effectweb-compiler-` followed by `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-x64`, `darwin-arm64`, or `win32-x64-msvc`.

GitHub's `npm` environment may also have approval rules if desired. The workflow requests `id-token: write` only in its publishing job. It runs on GitHub-hosted runners with Node 24; npm trusted publishing requires npm 11.5.1+ and Node 22.14+. No long-lived npm secret is required. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the current account setup.

## Subsequent releases

```sh
npm run version:release -- 0.1.1
npm run build
npm run check
npm test
npm run test:package
git add .
git commit -m "Release 0.1.1"
git push origin main
git tag v0.1.1
git push origin v0.1.1
```

The version script updates both packages, native dependency versions, Cargo metadata, and lockfiles. Pushing a `v*` tag runs validation, builds all native artifacts, packs them, and publishes via npm OIDC. The tag must match the package version. Prerelease versions use npm's `next` tag; stable versions use `latest`.

A manual Release run with `publish=true` is also an explicit publishing action, useful to retry a partial release. npm versions are immutable: fix a bad release with a new version rather than replacing tarballs. Keep consumers on matching runtime/compiler versions and the declared Effect peer version.
