<div align="center">
  <h1>Mosaic Packages</h1>
  <p>Official governed extensions for Mosaic.</p>
</div>

Official first-party Packages for [Mosaic](https://github.com/lockidynamics/mosaic).
This repository is the home of Mosaic’s official package catalog. Packages are
installed and enabled independently by Mosaic administrators.

## Packages

| Package | Identity | Catalog color | Status |
| --- | --- | --- | --- |
| [FlatPack](packages/flatpack) | `lockidynamics/flatpack` | `#ff9933` | Responsive Email image treatments |
| [Spell Check](packages/spellcheck) | `lockidynamics/spellcheck` | `#0fa64a` | Deterministic dictionary-backed text diagnostics |

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

## Spell Check

Enabled Libraries show a Spell Check tab in Library Settings for policy and dictionary controls. Package updates refresh catalog metadata, including the logo, from the newly saved repository snapshot.

Spell Check provides offline dictionary diagnostics through a resource-backed
Worker. It supports English and Spanish resources, bounded suggestions, and
UTF-16 source ranges. Spell Check owns its policy, dictionary records, actions,
and completion copy. Mosaic owns authorization and resource verification; the
package has no filesystem, network, or host authority.

See the [Spell Check package page](packages/spellcheck) for implementation and
redistribution details.

## For package developers

Official Packages belong in `packages/<catalog-slug>/`. Each package includes
its manifest, immutable release descriptor, prebuilt artifacts, schemas, role
suggestions, changelog, tests, and release history. See [Adding a Package](docs/ADDING-A-PACKAGE.md), [Contributing](CONTRIBUTING.md), and [Releasing](docs/RELEASING.md).

## Validate

Requirements: Node.js 22.18 or newer. Install the repository validator's
pinned development dependency; Packages still have no host runtime dependency.

```sh
npm ci
npm test
```

The validator discovers every `packages/*/mosaic-package.json`, checks unique
catalog and package identities, validates immutable artifact bytes and digests,
recomputes each release digest, enforces the catalog and release schemas, and
verifies optional role suggestions.

See [Security](SECURITY.md) for repository and package safety guidance.
