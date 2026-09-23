import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const worker = await readFile(new URL("dist/worker.js", root), "utf8")
const resource = async (name) => {
  const text = await readFile(new URL(`resources/${name}`, root), "utf8")
  return {
    resourceId: name,
    mediaType: "text/plain",
    digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    text,
  }
}
const english = await Promise.all([
  resource("spellcheck.en_us.aff"),
  resource("spellcheck.en_us.dic"),
])
const spanish = await Promise.all([
  resource("spellcheck.es_es.aff"),
  resource("spellcheck.es_es.dic"),
])

const recordRead = (readId, value = null, generation = 0, revision = 1) => ({
  readId,
  value: {
    generation,
    record:
      value === null
        ? null
        : {
            recordId: "policy",
            revision,
            checksum: `sha256:${"a".repeat(64)}`,
            value,
          },
  },
})
const collectionRead = (readId, values = [], generation = 0) => ({
  readId,
  value: {
    generation,
    records: values.map((value, index) => ({
      recordId: `word-${index + 1}`,
      revision: 1,
      checksum: `sha256:${String(index + 1).padStart(64, "0")}`,
      value,
    })),
  },
})
const libraryPolicy = (overrides = {}) => ({
  schemaVersion: "spellcheck.library_policy.v1",
  defaultLocale: "en-US",
  supportedLocales: ["en-US", "es-ES"],
  allowIgnore: true,
  allowLibraryAdd: true,
  allowGlobalAdd: true,
  blockCompletion: false,
  ...overrides,
})
const globalPolicy = (overrides = {}) => ({
  schemaVersion: "spellcheck.global_policy.v1",
  allowGlobalAdd: true,
  ...overrides,
})
const dictionaryEntry = (word, locale = "en-US") => ({
  schemaVersion: "spellcheck.dictionary_entry.v1",
  locale,
  word,
  normalized: word.normalize("NFC").toLowerCase(),
})
const reads = (overrides = {}) => [
  recordRead(
    "spellcheck.global_policy_read",
    overrides.globalPolicy === undefined ? null : overrides.globalPolicy,
    overrides.globalPolicyGeneration ?? 0,
    overrides.globalPolicyRevision ?? 1
  ),
  recordRead(
    "spellcheck.library_policy_read",
    overrides.libraryPolicy === undefined ? null : overrides.libraryPolicy,
    overrides.libraryPolicyGeneration ?? 0,
    overrides.libraryPolicyRevision ?? 1
  ),
  collectionRead(
    "spellcheck.global_dictionary_read",
    overrides.globalWords ?? [],
    overrides.globalGeneration ?? 0
  ),
  collectionRead(
    "spellcheck.library_dictionary_read",
    overrides.libraryWords ?? [],
    overrides.libraryGeneration ?? 0
  ),
  ...(overrides.extra ?? []),
]

function run(input, { operationId = "spellcheck.check", suppliedReads = reads(), resources = english } = {}) {
  return Function("input", "context", worker)(input, {
    operationId,
    suppliedReads,
    resources,
  })
}

test("checks real dictionaries with UTF-16 ranges and package-owned policy actions", () => {
  const result = run({
    schemaVersion: "mosaic-text-diagnostics-input-v2",
    sources: [{ sourceId: "subject", revision: "r1", text: "hello 😀 helooo" }],
    packageState: null,
  })
  assert.equal(result.complete, true)
  assert.deepEqual(result.diagnostics.map(({ word, start, end }) => ({ word, start, end })), [
    { word: "helooo", start: 9, end: 15 },
  ])
  assert.ok(result.diagnostics[0].suggestions.includes("hello"))
  assert.deepEqual(result.enabledActionIds, [
    "spellcheck.ignore_occurrence",
    "spellcheck.add_library",
    "spellcheck.add_global",
  ])
})

test("uses Library/document locales and scoped dictionaries while preserving skip rules", () => {
  const suppliedReads = reads({
    libraryPolicy: libraryPolicy({ defaultLocale: "es-ES" }),
    libraryWords: [dictionaryEntry("holaa", "es-ES")],
  })
  const result = run(
    {
      schemaVersion: "mosaic-text-diagnostics-input-v2",
      sources: [
        {
          sourceId: "body",
          revision: "r2",
          text: "holaa hola https://example.com a@b.test",
        },
      ],
      packageState: { schemaVersion: "spellcheck.document.v1", value: { locale: "es-ES" } },
    },
    { suppliedReads, resources: spanish }
  )
  assert.equal(result.complete, true)
  assert.deepEqual(result.diagnostics, [])
})

test("browser setup exposes only effective words and policy metadata", () => {
  const snapshot = run(
    {
      schemaVersion: "mosaic-text-diagnostics-browser-setup-v1",
      projectedReads: [
        {
          readId: "spellcheck.library_policy_read",
          mode: "record",
          value: {
            defaultLocale: "es-ES",
            supportedLocales: ["en-US", "es-ES"],
            allowIgnore: true,
          },
        },
        {
          readId: "spellcheck.global_dictionary_read",
          mode: "collection",
          value: [{ locale: "en-US", normalized: "brandname" }],
        },
        {
          readId: "spellcheck.library_dictionary_read",
          mode: "collection",
          value: [{ locale: "es-ES", normalized: "holaa" }],
        },
      ],
    },
    { operationId: "spellcheck.browser_setup", suppliedReads: [], resources: [] }
  )
  assert.deepEqual(snapshot, {
    schemaVersion: "spellcheck.browser_snapshot.v1",
    effectivePolicy: {
      defaultLocale: "es-ES",
      supportedLocales: ["en-US", "es-ES"],
      allowIgnore: true,
    },
    words: [
      { locale: "en-US", word: "brandname" },
      { locale: "es-ES", word: "holaa" },
    ],
  })
  assert.equal(JSON.stringify(snapshot).includes("recordId"), false)
  assert.equal(JSON.stringify(snapshot).includes("checksum"), false)
  const result = run(
    {
      schemaVersion: "mosaic-text-diagnostics-input-v2",
      sources: [{ sourceId: "subject", revision: "r1", text: "holaa typooo" }],
      packageState: null,
      browserSnapshot: snapshot,
    },
    { operationId: "spellcheck.browser_check", suppliedReads: [], resources: spanish }
  )
  assert.deepEqual(result.diagnostics.map(({ word }) => word), ["typooo"])
  assert.deepEqual(result.enabledActionIds, ["spellcheck.ignore_occurrence"])
})

test("returns fenced dictionary mutation plans and rejects duplicates", () => {
  const suppliedReads = reads({ libraryGeneration: 7 })
  const plan = run(
    {
      schemaVersion: "mosaic-text-diagnostics-action-v1",
      actionId: "spellcheck.add_library",
      target: {
        sourceId: "body",
        revision: "r1",
        start: 0,
        end: 6,
        word: "Mosaic",
        suggestions: [],
      },
      packageState: null,
    },
    { operationId: "spellcheck.diagnostic_action", suppliedReads, resources: [] }
  )
  assert.deepEqual(plan, {
    schemaVersion: "mosaic-package-native-command-result-v1",
    kind: "package-scoped-data-create",
    scope: "library",
    recordTypeId: "spellcheck.library_dictionary",
    expectedGeneration: 7,
    value: {
      schemaVersion: "spellcheck.dictionary_entry.v1",
      locale: "en-US",
      word: "Mosaic",
      normalized: "mosaic",
    },
  })

  assert.throws(
    () =>
      run(
        {
          schemaVersion: "mosaic-text-diagnostics-action-v1",
          actionId: "spellcheck.add_library",
          target: {
            sourceId: "body",
            revision: "r1",
            start: 0,
            end: 6,
            word: "Mosaic",
            suggestions: [],
          },
          packageState: null,
        },
        {
          operationId: "spellcheck.diagnostic_action",
          suppliedReads: reads({ libraryWords: [dictionaryEntry("mosaic")] }),
          resources: [],
        }
      ),
    /WORD_ALREADY_EXISTS/u
  )
})

test("keeps native admin settings and dictionaries capability-isolated", () => {
  const librarySettingsReads = [
    recordRead("spellcheck.library_policy_read", null),
  ]
  const model = run(
    { surface: "library-settings" },
    {
      operationId: "spellcheck.workspace_model",
      suppliedReads: librarySettingsReads,
      resources: [],
    }
  )
  assert.equal(model.schemaVersion, "mosaic-package-native-model-v2")
  assert.equal(model.surface, "library-settings")
  assert.equal(model.items.some((item) => item.kind === "collection"), false)

  const fields = Object.fromEntries(
    model.items.filter((item) => item.kind === "field").map((item) => [item.id, item.value])
  )
  fields["spellcheck.block_completion"] = true
  const plan = run(
    {
      schemaVersion: "mosaic-package-native-command-v1",
      commandId: "spellcheck.save_library_policy",
      input: { fields },
    },
    {
      operationId: "spellcheck.workspace_command",
      suppliedReads: librarySettingsReads,
      resources: [],
    }
  )
  assert.equal(plan.kind, "package-scoped-data-update")
  assert.equal(plan.scope, "library")
  assert.equal(plan.recordTypeId, "spellcheck.library_policy")
  assert.equal(plan.recordId, "policy")
  assert.equal(plan.expectedRevision, 0)
  assert.equal(plan.expectedGeneration, 0)
  assert.equal(plan.value.blockCompletion, true)

  const libraryDictionary = run(
    { surface: "library-settings" },
    {
      operationId: "spellcheck.workspace_model",
      suppliedReads: [
        recordRead("spellcheck.library_policy_read", libraryPolicy()),
        collectionRead("spellcheck.library_dictionary_read", []),
      ],
      resources: [],
    }
  )
  assert.deepEqual(
    libraryDictionary.items
      .filter((item) => item.kind === "collection")
      .map((item) => item.id),
    ["spellcheck.library_dictionary_view"]
  )

  const globalSettings = run(
    { surface: "content-workspace" },
    {
      operationId: "spellcheck.workspace_model",
      suppliedReads: [recordRead("spellcheck.global_policy_read", globalPolicy())],
      resources: [],
    }
  )
  assert.equal(globalSettings.items.some((item) => item.kind === "collection"), false)

  const globalDictionary = run(
    { surface: "content-workspace" },
    {
      operationId: "spellcheck.workspace_model",
      suppliedReads: [
        recordRead("spellcheck.global_policy_read", globalPolicy()),
        collectionRead("spellcheck.global_dictionary_read", []),
      ],
      resources: [],
    }
  )
  assert.deepEqual(
    globalDictionary.items
      .filter((item) => item.kind === "collection")
      .map((item) => item.id),
    ["spellcheck.global_dictionary_view"]
  )
})

test("contributes a document-language inspector and emits communication extension plans", () => {
  const suppliedReads = reads({
    libraryPolicy: libraryPolicy(),
    extra: [{ readId: "mosaic.document.package_extensions", value: {} }],
  })
  const model = run(
    { surface: "builder-inspector", emailId: "email-1" },
    { operationId: "spellcheck.locale_model", suppliedReads, resources: [] }
  )
  const field = model.items[0]
  assert.equal(field.id, "spellcheck.document_locale")
  assert.equal(field.value, "library-default")

  const plan = run(
    {
      schemaVersion: "mosaic-package-native-command-v1",
      commandId: "spellcheck.set_document_locale",
      input: {
        fieldId: "spellcheck.document_locale",
        value: "es-ES",
        context: {
          documentId: "email-1",
          expectedWorkingRevision: 4,
          packageExtensions: {},
        },
      },
    },
    {
      operationId: "spellcheck.locale_command",
      suppliedReads: [recordRead("spellcheck.library_policy_read", libraryPolicy())],
      resources: [],
    }
  )
  assert.deepEqual(plan, {
    schemaVersion: "mosaic-package-native-command-result-v1",
    kind: "communication-package-extension",
    packageKey: "spellcheck",
    expectedWorkingRevision: 4,
    extension: {
      schemaVersion: "spellcheck.document.v1",
      value: { locale: "es-ES" },
    },
  })
})

test("fails closed for diagnostic overflow or missing dictionary resources", () => {
  const text = Array.from({ length: 101 }, (_, index) => `zzzzword${index}`).join(" ")
  const input = {
    schemaVersion: "mosaic-text-diagnostics-input-v2",
    sources: [{ sourceId: "body", revision: "r1", text }],
    packageState: null,
  }
  assert.equal(run(input).complete, false)
  assert.deepEqual(
    run(
      { ...input, sources: [] },
      { resources: [], suppliedReads: reads() }
    ),
    {
      schemaVersion: "mosaic-text-diagnostics-result-v2",
      complete: false,
      diagnostics: [],
      enabledActionIds: [],
    }
  )
})

test("emitted Worker has no host escape surface", () => {
  for (const forbidden of ["process.", "require(", "import(", "fetch(", "globalThis.document", "window.", "Prisma", "SQL"]) {
    assert.equal(worker.includes(forbidden), false, forbidden)
  }
})
