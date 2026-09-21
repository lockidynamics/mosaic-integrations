# Package Host Reference

This official, prebuilt synthetic Package proves Mosaic's executable Package
Host without provider or customer behavior. Mosaic installs the immutable
release bytes and renders the workspace model with its own shared components.
The Package contributes no HTML, CSS, React, callbacks, or routes. Its bounded
action runs in the restricted Worker, while focused host tests separately prove
scoped Package Data, frozen text output, and generated assets through Mosaic's
governed interfaces.

There is intentionally no install script, build hook, network client, server
action, database access, Connector, or ambient Worker authority in this release.

The checked-in `dist` files are the release artifacts. Change them only as part
of a new immutable Package version, update every byte size and SHA-256 in
`mosaic-package-release.json`, recompute `releaseDigest`, add release notes, and
run `npm test` from the repository root.
