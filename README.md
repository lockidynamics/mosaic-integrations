<div align="center">
  <img src="packages/flatpack/logo.png" alt="FlatPack" width="160" />
  <h1>FlatPack</h1>
  <p>Responsive, production-ready image treatments for Mosaic Email.</p>
</div>

Official first-party Packages for [Mosaic](https://github.com/lockidynamics/mosaic).
This repository is the home of Mosaic’s official package catalog. Packages are
installed and enabled independently by Mosaic administrators.

## Packages

| Package | Identity | Status |
| --- | --- | --- |
| [FlatPack](packages/flatpack) | `lockidynamics/flatpack` | Responsive Email image treatments |

## FlatPack

FlatPack helps teams turn selected Email modules into responsive visual assets
while preserving the authoring experience inside Mosaic. Desktop and mobile
layouts, light and dark appearances, personalization, links, and accessibility
text remain part of the governed Email output.

In Mosaic, an administrator installs FlatPack and enables it for a Library.
Authors then configure FlatPack on eligible modules in the Email Builder. The
finished Email Package includes the generated assets when the Email is
completed.

See the [FlatPack package page](packages/flatpack) for customer-facing details.

## For package developers

Official Packages belong in `packages/<catalog-slug>/`. Each package includes
its manifest, immutable release descriptor, prebuilt artifacts, schemas, role
suggestions, changelog, tests, and release history. See [Adding a Package](docs/ADDING-A-PACKAGE.md), [Contributing](CONTRIBUTING.md), and [Releasing](docs/RELEASING.md).

## Validate

Requirements: Node.js 22.18 or newer. The repository has no install step or
runtime dependencies.

```sh
npm test
```

The validator discovers every `packages/*/mosaic-package.json`, checks unique
catalog and package identities, validates immutable artifact bytes and digests,
recomputes each release digest, and verifies optional role suggestions.

See [Security](SECURITY.md) for repository and package safety guidance.
