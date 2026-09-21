# Mosaic Integrations

Official first-party Packages for [Mosaic](https://github.com/lockidynamics/mosaic).
This repository is a package catalog, not one deployable package: registering
its root URL makes valid Packages discoverable, while an authorized Mosaic
Admin installs, enables, updates, disables, quarantines, and rolls back each
Package independently.

## Packages

| Package | Identity | Status |
| --- | --- | --- |
| [Package Host Reference](packages/package-host-reference) | `lockidynamics/reference_package` | N123 acceptance fixture |

Future official Packages belong in `packages/<catalog-slug>/`. Every package
owns its manifest, immutable release descriptor, prebuilt artifacts, schemas,
role suggestions, changelog, tests, and release history. Package identity is
`publisherKey + packageKey + version + releaseDigest`; repository paths are
discovery locations, not runtime or authorization identity.

## Validate

Requirements: Node.js 22.18 or newer. The repository has no install step or
runtime dependencies.

```sh
npm test
```

The validator discovers every `packages/*/mosaic-package.json`, checks unique
catalog and package identities, validates immutable artifact bytes and digests,
recomputes each release digest, and verifies optional role suggestions.

## Trust model

Repository registration never installs or activates every package. It records
one commit-pinned catalog snapshot. Each Package Release is separately staged
and installed, each Library binding is explicit, and Mosaic remains authoritative
for authentication, authorization, capability grants and denials, Library
isolation, Review, Complete, audit, artifact validation, and atomic activation.

Package UI runs only in an isolated frame through the typed UI Bridge.
Deterministic code runs only in the resource-limited Worker. Provider, network,
and AI behavior runs only through host-mediated Connector jobs. Packages receive
no ambient filesystem, network, environment, session, secret, database, host
DOM, Prisma, SQL, or server-action access.

See [Contributing](CONTRIBUTING.md), [Releasing](docs/RELEASING.md), and
[Security](SECURITY.md).
