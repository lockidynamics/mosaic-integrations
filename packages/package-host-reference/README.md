# Package Host Reference

This official, prebuilt synthetic Package proves Mosaic's executable Package
Host without provider or customer behavior. Mosaic installs the immutable
release bytes; the workspace then runs only inside the Package Host's opaque
sandboxed frame. It uses the typed UI Bridge for scoped reads, an authorized
Package Data command, and a deterministic Worker validator. The same release
also proves frozen text output and a generated PNG through host-owned artifact
validation and storage.

There is intentionally no install script, build hook, network client, server
action, database access, Connector, or ambient Worker authority in this release.

The checked-in `dist` files are the release artifacts. Change them only as part
of a new immutable Package version, update every byte size and SHA-256 in
`mosaic-package-release.json`, recompute `releaseDigest`, add release notes, and
run `npm test` from the repository root.
