# Contributing

## Add or change a Package

1. Put each Package in `packages/<catalog-slug>/` with its own
   `mosaic-package.json` and `mosaic-package-release.json`.
2. Keep `publisherKey: lockidynamics`; choose a stable, unique `packageKey` and
   namespace every Package capability, Contribution, schema, and operation ID.
3. Commit prebuilt artifacts. Mosaic never runs package installation scripts,
   repository builds, SQL, or DDL.
4. Use synthetic fixtures only. Never commit credentials, tokens, subscriber
   data, customer content, production identifiers, or private endpoints.
5. Update the Package changelog and README, run `npm test`, and request review
   from the path owners.

Packages may own UI, content behavior, codecs, validators, renderers, outputs,
asset generators, and Connector operations only through versioned host-mediated
contracts. They may not introduce another Review or Complete authority.

Do not reuse a published version for different bytes, move a published tag, or
change retained release artifacts. See [Releasing](docs/RELEASING.md).
