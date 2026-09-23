import nspell from "nspell"

const DIAGNOSTIC_INPUT = "mosaic-text-diagnostics-input-v2"
const DIAGNOSTIC_RESULT = "mosaic-text-diagnostics-result-v2"
const ACTION_INPUT = "mosaic-text-diagnostics-action-v1"
const NATIVE_COMMAND = "mosaic-package-native-command-v1"
const NATIVE_RESULT = "mosaic-package-native-command-result-v1"
const NATIVE_MODEL = "mosaic-package-native-model-v2"
const DOCUMENT_SCHEMA = "spellcheck.document.v1"
const DICTIONARY_SCHEMA = "spellcheck.dictionary_entry.v1"
const LIBRARY_POLICY_SCHEMA = "spellcheck.library_policy.v1"
const GLOBAL_POLICY_SCHEMA = "spellcheck.global_policy.v1"
const BROWSER_SNAPSHOT_SCHEMA = "spellcheck.browser_snapshot.v1"
const LOCALES = Object.freeze({
  "en-US": Object.freeze({
    label: "English (US)",
    aff: "spellcheck.en_us.aff",
    dic: "spellcheck.en_us.dic",
  }),
  "es-ES": Object.freeze({
    label: "Spanish (Spain)",
    aff: "spellcheck.es_es.aff",
    dic: "spellcheck.es_es.dic",
  }),
})
const READ = Object.freeze({
  globalPolicy: "spellcheck.global_policy_read",
  libraryPolicy: "spellcheck.library_policy_read",
  globalDictionary: "spellcheck.global_dictionary_read",
  libraryDictionary: "spellcheck.library_dictionary_read",
})
const TOKEN = /[\p{L}][\p{L}\p{M}]*(?:['’‐‑‒–—-][\p{L}][\p{L}\p{M}]*)*/gu
const PROTECTED = /(?:https?:\/\/|www\.)\S+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu
const MAX_SOURCES = 256
const MAX_SOURCE_CODE_UNITS = 1_000_000
const MAX_DIAGNOSTICS = 100
const MAX_SUGGESTIONS = 8
const MAX_TOKEN_CODE_UNITS = 256

switch (context.operationId) {
  case "spellcheck.check":
    return check(input)
  case "spellcheck.browser_setup":
    return browserSetup(input)
  case "spellcheck.browser_check":
    return check(input, browserSnapshot(input.browserSnapshot))
  case "spellcheck.diagnostic_action":
    return diagnosticAction(input)
  case "spellcheck.workspace_model":
    return workspaceModel(input)
  case "spellcheck.workspace_command":
    return workspaceCommand(input)
  case "spellcheck.locale_model":
    return localeModel(input)
  case "spellcheck.locale_command":
    return localeCommand(input)
  default:
    throw new Error("UNKNOWN_OPERATION")
}

function check(value, browser = null) {
  const request = object(value, "INVALID_INPUT")
  if (request.schemaVersion !== DIAGNOSTIC_INPUT) throw new Error("INVALID_INPUT_SCHEMA")
  const sources = request.sources
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES) throw new Error("INVALID_SOURCES")

  const policy = browser?.effectivePolicy ?? libraryPolicy()
  const locale = documentLocale(request.packageState, policy)
  if (!locale) return incomplete()
  const localeResources = LOCALES[locale]
  if (!localeResources) return incomplete()

  const resources = context.resources
  if (!Array.isArray(resources)) return incomplete()
  const aff = resource(resources, localeResources.aff)
  const dic = resource(resources, localeResources.dic)
  if (!aff || !dic) return incomplete()

  const accepted = browser
    ? new Set(browser.words.filter((entry) => entry.locale === locale).map((entry) => entry.word))
    : acceptedWords(locale)
  const dictionaryKey = `${aff.digest}:${dic.digest}`
  let spell = spellCache.get(dictionaryKey)
  if (!spell) {
    spell = nspell(aff.text, dic.text)
    spellCache.set(dictionaryKey, spell)
  }
  const cache = new Map()
  const sourceIds = new Set()
  const diagnostics = []

  for (const sourceValue of sources) {
    const source = object(sourceValue, "INVALID_SOURCE")
    if (
      typeof source.sourceId !== "string" ||
      typeof source.revision !== "string" ||
      typeof source.text !== "string" ||
      source.sourceId.length === 0 ||
      source.sourceId.length > 1024 ||
      source.revision.length === 0 ||
      source.revision.length > 128 ||
      source.text.length > MAX_SOURCE_CODE_UNITS
    )
      throw new Error("INVALID_SOURCE")
    if (sourceIds.has(source.sourceId)) throw new Error("DUPLICATE_SOURCE_ID")
    sourceIds.add(source.sourceId)
    const protectedRanges = [...source.text.matchAll(PROTECTED)].map((match) => [
      match.index,
      match.index + match[0].length,
    ])
    for (const match of source.text.matchAll(TOKEN)) {
      const start = match.index
      const word = match[0]
      const end = start + word.length
      if (protectedRanges.some(([from, to]) => start < to && end > from)) continue
      if (word.length > MAX_TOKEN_CODE_UNITS) return incomplete()
      if (accepted.has(normalize(word))) continue
      const lookup = baseLookup(word)
      let checked = cache.get(lookup)
      if (!checked) {
        const correct = spell.correct(lookup)
        checked = {
          correct,
          suggestions: correct
            ? []
            : spell.suggest(lookup).slice(0, MAX_SUGGESTIONS),
        }
        cache.set(lookup, checked)
      }
      if (checked.correct) continue
      diagnostics.push({
        sourceId: source.sourceId,
        revision: source.revision,
        start,
        end,
        word,
        suggestions: checked.suggestions,
      })
      if (diagnostics.length > MAX_DIAGNOSTICS) return incomplete()
    }
  }

  return {
    schemaVersion: DIAGNOSTIC_RESULT,
    complete: true,
    diagnostics,
    enabledActionIds: browser
      ? policy.allowIgnore ? ["spellcheck.ignore_occurrence"] : []
      : enabledActions(policy, globalPolicy()),
  }
}

function browserSetup(value) {
  const input = object(value, "INVALID_BROWSER_SETUP")
  if (
    input.schemaVersion !== "mosaic-text-diagnostics-browser-setup-v1" ||
    !Array.isArray(input.projectedReads)
  )
    throw new Error("INVALID_BROWSER_SETUP")
  const projected = (readId, mode) => {
    const matches = input.projectedReads.filter((entry) =>
      record(entry) && entry.readId === readId && entry.mode === mode
    )
    if (matches.length !== 1) throw new Error("INVALID_BROWSER_SETUP")
    return matches[0].value
  }
  const libraryValue = projected(READ.libraryPolicy, "record")
  const library = libraryValue === null
    ? { defaultLocale: "en-US", supportedLocales: ["en-US", "es-ES"], allowIgnore: true }
    : object(libraryValue, "INVALID_BROWSER_SETUP")
  if (
    !isLocale(library.defaultLocale) ||
    !Array.isArray(library.supportedLocales) ||
    library.supportedLocales.length < 1 ||
    library.supportedLocales.length > 2 ||
    !library.supportedLocales.every(isLocale) ||
    new Set(library.supportedLocales).size !== library.supportedLocales.length ||
    !library.supportedLocales.includes(library.defaultLocale) ||
    typeof library.allowIgnore !== "boolean"
  )
    throw new Error("INVALID_BROWSER_SETUP")
  const words = new Map()
  for (const readId of [READ.globalDictionary, READ.libraryDictionary]) {
    const entries = projected(readId, "collection")
    if (!Array.isArray(entries) || entries.length > 5000)
      throw new Error("INVALID_BROWSER_SETUP")
    for (const entry of entries) {
      const value = object(entry, "INVALID_BROWSER_SETUP")
      if (
        !isLocale(value.locale) ||
        typeof value.normalized !== "string" ||
        value.normalized.length < 1 ||
        value.normalized.length > 80 ||
        value.normalized !== normalize(value.normalized)
      )
        throw new Error("INVALID_BROWSER_SETUP")
      if (!library.supportedLocales.includes(value.locale)) continue
      words.set(`${value.locale}:${value.normalized}`, {
        locale: value.locale,
        word: value.normalized,
      })
    }
  }
  return {
    schemaVersion: BROWSER_SNAPSHOT_SCHEMA,
    effectivePolicy: {
      defaultLocale: library.defaultLocale,
      supportedLocales: library.supportedLocales,
      allowIgnore: library.allowIgnore,
    },
    words: [...words.values()].sort((a, b) =>
      a.locale.localeCompare(b.locale) || a.word.localeCompare(b.word)
    ),
  }
}

function browserSnapshot(value) {
  const snapshot = object(value, "INVALID_BROWSER_SNAPSHOT")
  if (snapshot.schemaVersion !== BROWSER_SNAPSHOT_SCHEMA)
    throw new Error("INVALID_BROWSER_SNAPSHOT")
  const policy = object(snapshot.effectivePolicy, "INVALID_BROWSER_SNAPSHOT")
  if (
    !isLocale(policy.defaultLocale) ||
    !Array.isArray(policy.supportedLocales) ||
    policy.supportedLocales.length < 1 ||
    policy.supportedLocales.length > 2 ||
    !policy.supportedLocales.every(isLocale) ||
    new Set(policy.supportedLocales).size !== policy.supportedLocales.length ||
    !policy.supportedLocales.includes(policy.defaultLocale) ||
    typeof policy.allowIgnore !== "boolean" ||
    !Array.isArray(snapshot.words) ||
    snapshot.words.length > 10_000
  )
    throw new Error("INVALID_BROWSER_SNAPSHOT")
  for (const entry of snapshot.words) {
    if (
      !record(entry) ||
      !isLocale(entry.locale) ||
      typeof entry.word !== "string" ||
      entry.word.length > 80 ||
      entry.word !== normalize(entry.word)
    )
      throw new Error("INVALID_BROWSER_SNAPSHOT")
  }
  return snapshot
}

function diagnosticAction(value) {
  const request = object(value, "INVALID_ACTION_INPUT")
  if (request.schemaVersion !== ACTION_INPUT) throw new Error("INVALID_ACTION_INPUT")
  const target = object(request.target, "INVALID_ACTION_TARGET")
  const word = checkedWord(target.word)
  const policy = libraryPolicy()
  const global = globalPolicy()
  const locale = documentLocale(request.packageState, policy)
  if (!locale) throw new Error("LOCALE_UNSUPPORTED")

  if (request.actionId === "spellcheck.add_library") {
    if (!policy.allowLibraryAdd) throw new Error("ACTION_DISABLED")
    return createWordPlan("library", READ.libraryDictionary, "spellcheck.library_dictionary", locale, word)
  }
  if (request.actionId === "spellcheck.add_global") {
    if (!policy.allowGlobalAdd || !global.allowGlobalAdd) throw new Error("ACTION_DISABLED")
    return createWordPlan("global", READ.globalDictionary, "spellcheck.global_dictionary", locale, word)
  }
  throw new Error("ACTION_UNSUPPORTED")
}

function workspaceModel(value) {
  modelInput(value, hasSupplied(READ.libraryPolicy) ? "library-settings" : "content-workspace")
  if (hasSupplied(READ.libraryDictionary)) return libraryDictionaryModel()
  if (hasSupplied(READ.libraryPolicy)) return librarySettingsModel()
  if (hasSupplied(READ.globalDictionary)) return globalDictionaryModel()
  if (hasSupplied(READ.globalPolicy)) return globalSettingsModel()
  throw new Error("SCOPED_READ_MISSING")
}

function librarySettingsModel() {
  const policy = libraryPolicy()
  return {
    schemaVersion: NATIVE_MODEL,
    surface: "library-settings",
    items: [
      {
        kind: "field",
        id: "spellcheck.default_locale",
        label: "Default language",
        control: "select",
        value: policy.defaultLocale,
        options: localeOptions(policy.supportedLocales),
      },
      {
        kind: "field",
        id: "spellcheck.support_en_us",
        label: "Enable English (US)",
        control: "switch",
        value: policy.supportedLocales.includes("en-US"),
      },
      {
        kind: "field",
        id: "spellcheck.support_es_es",
        label: "Enable Spanish (Spain)",
        control: "switch",
        value: policy.supportedLocales.includes("es-ES"),
      },
      {
        kind: "field",
        id: "spellcheck.allow_ignore",
        label: "Allow Ignore",
        control: "switch",
        value: policy.allowIgnore,
      },
      {
        kind: "field",
        id: "spellcheck.allow_library_add",
        label: "Allow Add to Library",
        control: "switch",
        value: policy.allowLibraryAdd,
      },
      {
        kind: "field",
        id: "spellcheck.allow_global_add",
        label: "Allow Add Globally",
        control: "switch",
        value: policy.allowGlobalAdd,
      },
      {
        kind: "field",
        id: "spellcheck.block_completion",
        label: "Block completion when spelling errors remain",
        control: "switch",
        value: policy.blockCompletion,
      },
      action(
        "spellcheck.save_library_policy_action",
        "Save Library settings",
        "settings",
        "spellcheck.save_library_policy"
      ),
    ],
  }
}

function libraryDictionaryModel() {
  const policy = libraryPolicy()
  return {
    schemaVersion: NATIVE_MODEL,
    surface: "library-settings",
    items: [
      wordField(),
      localeField(policy.defaultLocale, policy.supportedLocales),
      {
        ...action(
          "spellcheck.add_library_word_action",
          "Add to Library",
          "add",
          "spellcheck.add_library_word"
        ),
        disabled: !policy.allowLibraryAdd,
      },
      dictionaryCollection(
        "spellcheck.library_dictionary_view",
        "Library dictionary",
        "Words accepted only in this Library.",
        collection(READ.libraryDictionary),
        "spellcheck.edit_library_word",
        "spellcheck.delete_library_word"
      ),
    ],
  }
}

function globalSettingsModel() {
  const policy = globalPolicy()
  return {
    schemaVersion: NATIVE_MODEL,
    surface: "content-workspace",
    items: [
      {
        kind: "field",
        id: "spellcheck.global_allow_add",
        label: "Allow global dictionary additions",
        control: "switch",
        value: policy.allowGlobalAdd,
      },
      action(
        "spellcheck.save_global_policy_action",
        "Save global settings",
        "settings",
        "spellcheck.save_global_policy"
      ),
    ],
  }
}

function globalDictionaryModel() {
  const policy = globalPolicy()
  const locales = Object.keys(LOCALES)
  return {
    schemaVersion: NATIVE_MODEL,
    surface: "content-workspace",
    items: [
      wordField(),
      localeField("en-US", locales),
      {
        ...action(
          "spellcheck.add_global_word_action",
          "Add Globally",
          "add",
          "spellcheck.add_global_word"
        ),
        disabled: !policy.allowGlobalAdd,
      },
      dictionaryCollection(
        "spellcheck.global_dictionary_view",
        "Global dictionary",
        "Words accepted across enabled Libraries.",
        collection(READ.globalDictionary),
        "spellcheck.edit_global_word",
        "spellcheck.delete_global_word"
      ),
    ],
  }
}

function wordField() {
  return {
    kind: "field",
    id: "spellcheck.new_word",
    label: "Dictionary word",
    control: "text",
    value: "",
  }
}

function localeField(value, locales) {
  return {
    kind: "field",
    id: "spellcheck.new_word_locale",
    label: "Dictionary language",
    control: "select",
    value,
    options: localeOptions(locales),
  }
}

function workspaceCommand(value) {
  const command = nativeCommand(value)
  const payload = object(command.input, "INVALID_COMMAND_INPUT")
  const fields = object(payload.fields, "INVALID_COMMAND_FIELDS")

  switch (command.commandId) {
    case "spellcheck.save_library_policy":
      return saveLibraryPolicy(fields)
    case "spellcheck.save_global_policy":
      return saveGlobalPolicy(fields)
    case "spellcheck.add_library_word":
      return addWorkspaceWord(fields, "library")
    case "spellcheck.add_global_word":
      return addWorkspaceWord(fields, "global")
    case "spellcheck.edit_library_word":
      return editWorkspaceWord(payload, "library")
    case "spellcheck.delete_library_word":
      return deleteWorkspaceWord(payload, "library")
    case "spellcheck.edit_global_word":
      return editWorkspaceWord(payload, "global")
    case "spellcheck.delete_global_word":
      return deleteWorkspaceWord(payload, "global")
    default:
      throw new Error("COMMAND_UNSUPPORTED")
  }
}

function localeModel(value) {
  modelInput(value, "builder-inspector")
  const policy = libraryPolicy()
  const extensions = supplied("mosaic.document.package_extensions", true)
  const extension = extensions && record(extensions) ? extensions.spellcheck : null
  const current = extensionLocale(extension)
  const selected = current && policy.supportedLocales.includes(current) ? current : "library-default"
  return {
    schemaVersion: NATIVE_MODEL,
    surface: "builder-inspector",
    items: [
      {
        kind: "field",
        id: "spellcheck.document_locale",
        label: "Spell Check language",
        control: "select",
        value: selected,
        options: [
          { id: "library-default", label: `Library default (${LOCALES[policy.defaultLocale].label})` },
          ...localeOptions(policy.supportedLocales),
        ],
        commandId: "spellcheck.set_document_locale",
      },
    ],
  }
}

function localeCommand(value) {
  const command = nativeCommand(value)
  if (command.commandId !== "spellcheck.set_document_locale") throw new Error("COMMAND_UNSUPPORTED")
  const payload = object(command.input, "INVALID_COMMAND_INPUT")
  if (payload.fieldId !== "spellcheck.document_locale") throw new Error("INVALID_COMMAND_FIELD")
  const contextValue = object(payload.context, "INVALID_COMMAND_CONTEXT")
  const revision = contextValue.expectedWorkingRevision
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("INVALID_COMMAND_REVISION")
  const policy = libraryPolicy()
  const locale = payload.value
  if (locale === "library-default")
    return {
      schemaVersion: NATIVE_RESULT,
      kind: "communication-package-extension",
      packageKey: "spellcheck",
      expectedWorkingRevision: revision,
      extension: null,
    }
  if (typeof locale !== "string" || !policy.supportedLocales.includes(locale))
    throw new Error("LOCALE_UNSUPPORTED")
  return {
    schemaVersion: NATIVE_RESULT,
    kind: "communication-package-extension",
    packageKey: "spellcheck",
    expectedWorkingRevision: revision,
    extension: {
      schemaVersion: DOCUMENT_SCHEMA,
      value: { locale },
    },
  }
}

function saveLibraryPolicy(fields) {
  const read = recordRead(READ.libraryPolicy)
  const supportedLocales = []
  if (booleanField(fields, "spellcheck.support_en_us")) supportedLocales.push("en-US")
  if (booleanField(fields, "spellcheck.support_es_es")) supportedLocales.push("es-ES")
  if (!supportedLocales.length) throw new Error("LOCALE_REQUIRED")
  const requestedDefault = stringField(fields, "spellcheck.default_locale")
  const defaultLocale = supportedLocales.includes(requestedDefault)
    ? requestedDefault
    : supportedLocales[0]
  return updatePlan(
    "library",
    "spellcheck.library_policy",
    "policy",
    read,
    {
      schemaVersion: LIBRARY_POLICY_SCHEMA,
      defaultLocale,
      supportedLocales,
      allowIgnore: booleanField(fields, "spellcheck.allow_ignore"),
      allowLibraryAdd: booleanField(fields, "spellcheck.allow_library_add"),
      allowGlobalAdd: booleanField(fields, "spellcheck.allow_global_add"),
      blockCompletion: booleanField(fields, "spellcheck.block_completion"),
    }
  )
}

function saveGlobalPolicy(fields) {
  const read = recordRead(READ.globalPolicy)
  return updatePlan(
    "global",
    "spellcheck.global_policy",
    "policy",
    read,
    {
      schemaVersion: GLOBAL_POLICY_SCHEMA,
      allowGlobalAdd: booleanField(fields, "spellcheck.global_allow_add"),
    }
  )
}

function addWorkspaceWord(fields, scope) {
  const locale = stringField(fields, "spellcheck.new_word_locale")
  if (scope === "library") {
    const policy = libraryPolicy()
    if (!policy.supportedLocales.includes(locale)) throw new Error("LOCALE_UNSUPPORTED")
    if (!policy.allowLibraryAdd) throw new Error("ACTION_DISABLED")
  } else {
    if (!isLocale(locale)) throw new Error("LOCALE_UNSUPPORTED")
    if (!globalPolicy().allowGlobalAdd) throw new Error("ACTION_DISABLED")
  }
  return createWordPlan(
    scope,
    scope === "library" ? READ.libraryDictionary : READ.globalDictionary,
    scope === "library" ? "spellcheck.library_dictionary" : "spellcheck.global_dictionary",
    locale,
    checkedWord(stringField(fields, "spellcheck.new_word"))
  )
}

function editWorkspaceWord(payload, scope) {
  const rowId = stringValue(payload.rowId, "INVALID_ROW_ID")
  const cells = object(payload.cells, "INVALID_ROW_CELLS")
  const word = checkedWord(cells.word)
  const locale = stringValue(cells.locale, "INVALID_LOCALE")
  if (scope === "library") {
    if (!libraryPolicy().supportedLocales.includes(locale))
      throw new Error("LOCALE_UNSUPPORTED")
  } else if (!isLocale(locale)) throw new Error("LOCALE_UNSUPPORTED")
  const readId = scope === "library" ? READ.libraryDictionary : READ.globalDictionary
  const recordTypeId = scope === "library" ? "spellcheck.library_dictionary" : "spellcheck.global_dictionary"
  const state = collection(readId)
  const row = state.records.find((item) => item.recordId === rowId)
  if (!row) throw new Error("ROW_STALE")
  ensureUnique(state.records, rowId, locale, word)
  return {
    schemaVersion: NATIVE_RESULT,
    kind: "package-scoped-data-update",
    scope,
    recordTypeId,
    recordId: row.recordId,
    expectedRevision: row.revision,
    expectedGeneration: state.generation,
    value: dictionaryEntry(locale, word),
  }
}

function deleteWorkspaceWord(payload, scope) {
  const rowId = stringValue(payload.rowId, "INVALID_ROW_ID")
  const readId = scope === "library" ? READ.libraryDictionary : READ.globalDictionary
  const recordTypeId = scope === "library" ? "spellcheck.library_dictionary" : "spellcheck.global_dictionary"
  const state = collection(readId)
  const row = state.records.find((item) => item.recordId === rowId)
  if (!row) throw new Error("ROW_STALE")
  return {
    schemaVersion: NATIVE_RESULT,
    kind: "package-scoped-data-delete",
    scope,
    recordTypeId,
    recordId: row.recordId,
    expectedRevision: row.revision,
    expectedGeneration: state.generation,
  }
}

function createWordPlan(scope, readId, recordTypeId, locale, word) {
  const state = collection(readId)
  ensureUnique(state.records, null, locale, word)
  return {
    schemaVersion: NATIVE_RESULT,
    kind: "package-scoped-data-create",
    scope,
    recordTypeId,
    expectedGeneration: state.generation,
    value: dictionaryEntry(locale, word),
  }
}

function updatePlan(scope, recordTypeId, recordId, read, value) {
  return {
    schemaVersion: NATIVE_RESULT,
    kind: "package-scoped-data-update",
    scope,
    recordTypeId,
    recordId,
    expectedRevision: read.record?.revision ?? 0,
    expectedGeneration: read.generation,
    value,
  }
}

function dictionaryCollection(id, label, description, state, editCommand, deleteCommand) {
  const rows = [...state.records]
    .sort((left, right) => {
      const a = left.value
      const b = right.value
      return `${a.locale}:${a.normalized}`.localeCompare(`${b.locale}:${b.normalized}`, "en")
    })
    .map((item) => ({
      id: item.recordId,
      cells: { word: item.value.word, locale: item.value.locale },
    }))
  return {
    kind: "collection",
    id,
    label,
    description,
    searchable: true,
    columns: [
      { id: "word", label: "Word", editable: true },
      { id: "locale", label: "Language", editable: true },
    ],
    rows,
    actions: [
      { id: `${id}.save`, label: "Save", icon: "edit", commandId: editCommand },
      { id: `${id}.remove`, label: "Remove", icon: "delete", commandId: deleteCommand },
    ],
  }
}

function action(id, label, icon, commandId) {
  return { kind: "action", id, label, icon, commandId }
}

function libraryPolicy() {
  const read = recordRead(READ.libraryPolicy)
  if (!read.record) {
    return {
      schemaVersion: LIBRARY_POLICY_SCHEMA,
      defaultLocale: "en-US",
      supportedLocales: ["en-US", "es-ES"],
      allowIgnore: true,
      allowLibraryAdd: true,
      allowGlobalAdd: true,
      blockCompletion: false,
    }
  }
  const value = object(read.record.value, "INVALID_LIBRARY_POLICY")
  if (
    value.schemaVersion !== LIBRARY_POLICY_SCHEMA ||
    !isLocale(value.defaultLocale) ||
    !Array.isArray(value.supportedLocales) ||
    value.supportedLocales.length < 1 ||
    value.supportedLocales.length > 2 ||
    !value.supportedLocales.every(isLocale) ||
    new Set(value.supportedLocales).size !== value.supportedLocales.length ||
    !value.supportedLocales.includes(value.defaultLocale) ||
    typeof value.allowIgnore !== "boolean" ||
    typeof value.allowLibraryAdd !== "boolean" ||
    typeof value.allowGlobalAdd !== "boolean" ||
    typeof value.blockCompletion !== "boolean"
  )
    throw new Error("INVALID_LIBRARY_POLICY")
  return value
}

function globalPolicy() {
  const read = recordRead(READ.globalPolicy)
  if (!read.record) return { schemaVersion: GLOBAL_POLICY_SCHEMA, allowGlobalAdd: true }
  const value = object(read.record.value, "INVALID_GLOBAL_POLICY")
  if (value.schemaVersion !== GLOBAL_POLICY_SCHEMA || typeof value.allowGlobalAdd !== "boolean")
    throw new Error("INVALID_GLOBAL_POLICY")
  return value
}

function acceptedWords(locale) {
  const accepted = new Set()
  for (const readId of [READ.globalDictionary, READ.libraryDictionary]) {
    for (const recordValue of collection(readId).records) {
      const value = object(recordValue.value, "INVALID_DICTIONARY_ENTRY")
      if (
        value.schemaVersion !== DICTIONARY_SCHEMA ||
        !isLocale(value.locale) ||
        typeof value.word !== "string" ||
        typeof value.normalized !== "string" ||
        value.normalized !== normalize(value.word)
      )
        throw new Error("INVALID_DICTIONARY_ENTRY")
      if (value.locale === locale) accepted.add(value.normalized)
    }
  }
  return accepted
}

function enabledActions(library, global) {
  const result = []
  if (library.allowIgnore) result.push("spellcheck.ignore_occurrence")
  if (library.allowLibraryAdd) result.push("spellcheck.add_library")
  if (library.allowGlobalAdd && global.allowGlobalAdd) result.push("spellcheck.add_global")
  return result
}

function documentLocale(packageState, policy) {
  if (packageState === null || packageState === undefined) return policy.defaultLocale
  const locale = extensionLocale(packageState)
  if (!locale || !policy.supportedLocales.includes(locale)) return null
  return locale
}

function extensionLocale(value) {
  if (value === null || value === undefined) return null
  if (!record(value) || value.schemaVersion !== DOCUMENT_SCHEMA || !record(value.value))
    return null
  return isLocale(value.value.locale) ? value.value.locale : null
}

function dictionaryEntry(locale, word) {
  return {
    schemaVersion: DICTIONARY_SCHEMA,
    locale,
    word,
    normalized: normalize(word),
  }
}

function ensureUnique(records, excludedId, locale, word) {
  const normalized = normalize(word)
  if (
    records.some(
      (item) =>
        item.recordId !== excludedId &&
        item.value.locale === locale &&
        item.value.normalized === normalized
    )
  )
    throw new Error("WORD_ALREADY_EXISTS")
}

function recordRead(readId) {
  const value = object(supplied(readId), "INVALID_SCOPED_READ")
  if (!Number.isSafeInteger(value.generation) || value.generation < 0)
    throw new Error("INVALID_SCOPED_READ")
  const stored = value.record
  if (stored === null) return { generation: value.generation, record: null }
  const item = object(stored, "INVALID_SCOPED_READ")
  if (
    typeof item.recordId !== "string" ||
    !Number.isSafeInteger(item.revision) ||
    item.revision < 1 ||
    !record(item.value)
  )
    throw new Error("INVALID_SCOPED_READ")
  return { generation: value.generation, record: item }
}

function collection(readId) {
  const value = object(supplied(readId), "INVALID_SCOPED_READ")
  if (!Number.isSafeInteger(value.generation) || value.generation < 0 || !Array.isArray(value.records))
    throw new Error("INVALID_SCOPED_READ")
  const records = value.records.map((stored) => {
    const item = object(stored, "INVALID_SCOPED_READ")
    if (
      typeof item.recordId !== "string" ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1 ||
      !record(item.value)
    )
      throw new Error("INVALID_SCOPED_READ")
    return item
  })
  return { generation: value.generation, records }
}

function hasSupplied(readId) {
  return (
    Array.isArray(context.suppliedReads) &&
    context.suppliedReads.some(
      (entry) => record(entry) && entry.readId === readId
    )
  )
}

function supplied(readId, optional = false) {
  const matches = Array.isArray(context.suppliedReads)
    ? context.suppliedReads.filter((entry) => record(entry) && entry.readId === readId)
    : []
  if (matches.length === 1) return matches[0].value
  if (optional && matches.length === 0) return null
  throw new Error("SCOPED_READ_MISSING")
}

function resource(resources, resourceId) {
  const matches = resources.filter((entry) => record(entry) && entry.resourceId === resourceId)
  const value = matches.length === 1 ? matches[0] : null
  if (
    !record(value) ||
    value.mediaType !== "text/plain" ||
    typeof value.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.digest) ||
    typeof value.text !== "string" ||
    value.text.length === 0 ||
    value.text.length > 5_000_000
  )
    return null
  return value
}

function nativeCommand(value) {
  const command = object(value, "INVALID_NATIVE_COMMAND")
  if (
    command.schemaVersion !== NATIVE_COMMAND ||
    typeof command.commandId !== "string" ||
    !command.commandId.startsWith("spellcheck.")
  )
    throw new Error("INVALID_NATIVE_COMMAND")
  return command
}

function modelInput(value, expectedSurface) {
  const model = object(value, "INVALID_MODEL_INPUT")
  if (model.surface !== expectedSurface) throw new Error("INVALID_MODEL_SURFACE")
  return model
}

function localeOptions(locales) {
  return locales.map((locale) => ({ id: locale, label: LOCALES[locale].label }))
}

function checkedWord(value) {
  const word = stringValue(value, "INVALID_WORD").normalize("NFC").trim()
  if (
    word.length === 0 ||
    word.length > 80 ||
    /[\p{Cc}\p{Cf}<>]/u.test(word) ||
    !/^[\p{L}][\p{L}\p{M}]*(?:['’‐‑‒–—-][\p{L}][\p{L}\p{M}]*)*$/u.test(word)
  )
    throw new Error("INVALID_WORD")
  return word
}

function normalize(value) {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’＇]/gu, "'")
    .replace(/[‐‑‒–—−]/gu, "-")
}

function baseLookup(value) {
  return value
    .normalize("NFC")
    .replace(/[’＇]/gu, "'")
    .replace(/[‐‑‒–—−]/gu, "-")
}

function booleanField(fields, id) {
  if (typeof fields[id] !== "boolean") throw new Error("INVALID_COMMAND_FIELD")
  return fields[id]
}

function stringField(fields, id) {
  return stringValue(fields[id], "INVALID_COMMAND_FIELD")
}

function stringValue(value, code) {
  if (typeof value !== "string") throw new Error(code)
  return value
}

function isLocale(value) {
  return value === "en-US" || value === "es-ES"
}

function object(value, code) {
  if (!record(value)) throw new Error(code)
  return value
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function incomplete() {
  return {
    schemaVersion: DIAGNOSTIC_RESULT,
    complete: false,
    diagnostics: [],
    enabledActionIds: [],
  }
}
