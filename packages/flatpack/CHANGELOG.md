# Changelog

## [1.2.0] - 2026-09-22

### Changed

- Declare the v2 raster-plan contract explicitly and request the Mosaic-owned Builder bracket rail, icon, color, Link and ALT controls through FlatPack authoring metadata. New generated raster assets use package-neutral Mosaic IDs while retained FlatPack IDs and completed bytes remain readable. No Worker artifact or stored-data migration.
- Requires Mosaic 0.0.3, the first host version with this authoring and generated-asset contract.

## [1.1.1] - 2026-09-22

### Changed

- Declare FlatPack-owned completion copy for raster Worker and output-plan
  failures. Mosaic continues to own renderer, resource, storage, and artifact
  failures. Requires Mosaic 0.0.2; no artifact or stored-data migration.

## [1.1.0] - 2026-09-22

### Changed

- Added the v2 raster-plan protocol so Mosaic can omit dark presentation
  variants when Library Dark Mode governance is disabled.

## [1.0.0] - 2026-09-21

### Added

- Declared the native `email-raster-region` contribution.
- Added bounded source, plan-request, and plan-result schemas.
- Added a restricted Worker that validates canonical state inputs and returns
  the four-variant raster plan.
