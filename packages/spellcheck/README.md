# Spell Check

Spell Check is a deterministic, dictionary-backed Worker package for Mosaic.
It reports misspelled words with UTF-16 source ranges and bounded suggestions.

The Worker receives locale resources through the host's `context.resources`:
`spellcheck.en_us.aff`, `spellcheck.en_us.dic`, `spellcheck.es_es.aff`, and
`spellcheck.es_es.dic`. The host owns resource digest verification and all
authorization. The Worker has no filesystem, network, or host authority.

The checked-in `dist/worker.js` is the self-contained runtime artifact. Build
dependencies are pinned in this directory's `package-lock.json` and are not
needed by Mosaic at runtime.

Mosaic supplies the package with the selected `en-US` or `es-ES` dictionary
resources. The package declares the `spellcheck.check` text-diagnostics
operation and requires no package capability to run diagnostics; the host owns
the `library.read` authorization used to provide sources. Dictionary and policy
records are host-scoped settings: Library and global dictionary management,
configuration, and diagnostic ignore actions use the corresponding privileged
capabilities declared in the release descriptor.

The default policy uses `en-US`, supports `en-US` and `es-ES` document locales,
and does not block Complete. Library policy controls the supported locales,
ignore and dictionary actions, and completion blocking. Mosaic enforces the
package-declared completion setting against saved content.
When Spell Check blocks Complete, the release supplies the customer-facing reason
and Mosaic labels the failure as `Package · Spell Check · Check spelling`. Host
runtime, source, authorization, and storage failures remain labeled as Mosaic.

Catalog color: `#0fa64a`.

Dictionary resources are redistributed from the pinned `dictionary-en` and
`dictionary-es` packages under their included license terms. See
[`LICENSES.md`](LICENSES.md) and [`SOURCES.md`](SOURCES.md). The package has no
filesystem, network, account, or external service permissions. The host limits
the combined UTF-8 resource payload to 2,000,000 bytes and bounds each diagnostic result
to 100 entries; the Worker fails explicitly when those limits or resource
integrity checks are not satisfied.

Tokenization requires a Unicode letter at the start and keeps combining marks,
apostrophes, and hyphens inside one token. URLs and email addresses are skipped.
Base Hunspell lookup preserves NFC text and casing; custom dictionary lookup is
case-insensitive. A hyphenated token is checked as one dictionary word and is
reported as one original UTF-16 range.
