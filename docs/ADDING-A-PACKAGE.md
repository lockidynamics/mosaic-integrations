# Adding an official Package

Create `packages/<catalog-slug>/` with:

```text
mosaic-package.json
mosaic-package-release.json
CHANGELOG.md
README.md
roles.json                 # optional advisory suggestions
logo.svg                   # or a bounded PNG/JPEG/WebP
dist/                      # immutable prebuilt artifacts
schemas/                   # closed JSON Schemas
```

The repository validator automatically discovers the package. Keep catalog
slugs and `packageKey` values unique across the repository. A malformed package
fails the whole commit-pinned repository snapshot, so all packages must pass
before merging.

Do not add empty framework directories, shared runtime code, package install
hooks, database migrations, or a repository-wide Package identity. Share only
repository validation and governance; each Package owns an independent release
and lifecycle.
