# Releasing a Package

1. Change only one Package's source and prebuilt artifacts.
2. Increment that Package's version in both manifests.
3. Update artifact byte sizes and SHA-256 values in
   `mosaic-package-release.json`.
4. Recompute `releaseDigest` over Mosaic canonical JSON after removing only
   `$schema` and `releaseDigest`.
5. Add the version to the Package changelog and run `npm test`.
6. Merge through review, then create an immutable package-specific tag such as
   `reference-package-v1.0.0` or `mobile-messages-v3.0.0`.

Never reuse or move a published tag and never replace bytes for an existing
`publisherKey + packageKey + version + releaseDigest`. Updating the repository
only offers a Candidate; Mosaic does not activate it until an authorized Admin
explicitly accepts the update. Invalid, unavailable, postponed, and declined
Candidates cannot affect the active Installed Release.
