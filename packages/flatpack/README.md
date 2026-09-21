# FlatPack

FlatPack is Mosaic's first native package for governed Email output behavior.
It declares the `email-raster-region` contract and returns a deterministic,
host-validated raster plan for each canonical resolved source state and all
four required presentation variants: desktop light, desktop dark, mobile
light, and mobile dark.

FlatPack does not render HTML, access Mosaic data, evaluate recipients, fetch
resources, or write artifacts. Mosaic owns source resolution, personalization,
fonts, rendering, generated-byte persistence, Email Package assembly, Review,
Complete, and release activation. The restricted Worker only validates and
returns the bounded plan described by the versioned schemas.

Drafts and Review retain native Module content and saved FlatPack settings.
Only fixed Email Complete generates image assets for the final HTML Email Package;
completed previews/downloads consume those immutable bytes. Draft Preview and
PDF/JPG projections do not generate FlatPack assets.

The release is immutable. Update artifact byte sizes, SHA-256 values, and the
release digest together when publishing a new version. There are no install
scripts, build hooks, dependencies, network calls, filesystem access, secrets,
database access, or package-owned server/browser code.
