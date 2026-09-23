import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import { validateRepository } from "../scripts/validate-repository.mjs"

const root = resolve(import.meta.dirname, "..")

function canonicalJson(value, omitted = new Set()) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  return `{${Object.keys(value)
    .filter((key) => !omitted.has(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

function refreshReleaseDigest(release) {
  release.releaseDigest = `sha256:${createHash("sha256")
    .update(canonicalJson(release, new Set(["$schema", "releaseDigest"])))
    .digest("hex")}`
}

test("the official repository contains valid independent Package Releases", async () => {
  assert.deepEqual(await validateRepository(root), [
    {
      slug: "flatpack",
      packageKey: "flatpack",
      version: "1.2.0",
    },
    {
      slug: "spellcheck",
      packageKey: "spellcheck",
      version: "0.2.3",
    },
  ])
  const spellcheck = JSON.parse(await readFile(resolve(root, "packages/spellcheck/mosaic-package-release.json"), "utf8"))
  assert.deepEqual(spellcheck.contributions.filter((item) => item.surface === "library-settings").map((item) => item.id), ["spellcheck.library_settings", "spellcheck.library_dictionary_settings"])
  const actions = spellcheck.contributions.find((item) => item.kind === "text-diagnostics").presentation.actions
  assert.deepEqual(actions.map(({ label, parentLabel }) => [label, parentLabel ?? null]), [
    ['Ignore "{word}"', null],
    ['Add "{word}" to Library', null],
    ['Add "{word}" globally', null],
  ])
  for (const [name, color] of [["flatpack", "#ff9933"], ["spellcheck", "#0fa64a"]]) {
    const catalog = JSON.parse(await readFile(resolve(root, `packages/${name}/mosaic-package.json`), "utf8"))
    assert.equal(catalog.color, color)
  }
})

test("tampered release artifacts and release identities fail closed", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "mosaic-integrations-test-"))
  try {
    await cp(root, temporaryRoot, {
      recursive: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    })
    const worker = resolve(temporaryRoot, "packages/flatpack/dist/worker.js")
    await writeFile(worker, `${await readFile(worker, "utf8")}\n`)
    await assert.rejects(validateRepository(temporaryRoot), /artifact byte size mismatch/u)

    await cp(root, temporaryRoot, {
      recursive: true,
      force: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    })
    const originalWorker = await readFile(worker, "utf8")
    await writeFile(worker, `${originalWorker[0] === "a" ? "b" : "a"}${originalWorker.slice(1)}`)
    await assert.rejects(validateRepository(temporaryRoot), /artifact digest mismatch/u)

    await cp(root, temporaryRoot, {
      recursive: true,
      force: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    })
    const releasePath = resolve(
      temporaryRoot,
      "packages/flatpack/mosaic-package-release.json"
    )
    const release = JSON.parse(await readFile(releasePath, "utf8"))
    release.releaseDigest = `sha256:${"0".repeat(64)}`
    await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`)
    await assert.rejects(validateRepository(temporaryRoot), /release digest mismatch/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("release schema rejects unknown fields and malformed artifact metadata", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "mosaic-integrations-schema-test-"))
  try {
    await cp(root, temporaryRoot, {
      recursive: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    })
    const releasePath = resolve(temporaryRoot, "packages/flatpack/mosaic-package-release.json")
    const original = JSON.parse(await readFile(releasePath, "utf8"))
    for (const mutate of [
      (release) => { release.unexpected = true },
      (release) => { release.artifacts[0].kind = "unknown" },
      (release) => { release.artifacts[0].mediaType = "" },
    ]) {
      const release = structuredClone(original)
      mutate(release)
      refreshReleaseDigest(release)
      await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`)
      await assert.rejects(validateRepository(temporaryRoot), /release schema mismatch/u)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("catalog validation rejects unsupported categories and malformed colors", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "mosaic-integrations-catalog-test-"))
  try {
    await cp(root, temporaryRoot, {
      recursive: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    })
    const catalogPath = resolve(temporaryRoot, "packages/spellcheck/mosaic-package.json")
    const original = JSON.parse(await readFile(catalogPath, "utf8"))
    for (const mutate of [
      (catalog) => { catalog.category = "authoring" },
      (catalog) => { catalog.color = "#0fa" },
      (catalog) => { catalog.color = "#0fa64a80" },
      (catalog) => { catalog.color = "0fa64a" },
      (catalog) => { catalog.color = "#0fa64g" },
    ]) {
      const catalog = { ...original }
      mutate(catalog)
      await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
      await assert.rejects(validateRepository(temporaryRoot), /catalog schema mismatch/u)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("Spell Check releases reject missing declared data schemas", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "mosaic-integrations-spellcheck-test-"))
  try {
    await cp(root, temporaryRoot, { recursive: true, filter: (source) => !source.includes("node_modules") && !source.includes(".git") })
    const releasePath = resolve(temporaryRoot, "packages/spellcheck/mosaic-package-release.json")
    const release = JSON.parse(await readFile(releasePath, "utf8"))
    release.artifacts = release.artifacts.filter((artifact) => artifact.path !== "schemas/spellcheck.dictionary_entry.v1.schema.json")
    await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`)
    await assert.rejects(validateRepository(temporaryRoot), /data record schema is undeclared spellcheck\.dictionary_entry\.v1/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})


test("completion participants require customer copy and reserve Mosaic failures", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "mosaic-integrations-completion-test-"))
  try {
    await cp(root, temporaryRoot, { recursive: true, filter: (source) => !source.includes("node_modules") && !source.includes(".git") })
    const spellPath = resolve(temporaryRoot, "packages/spellcheck/mosaic-package-release.json")
    const flatPath = resolve(temporaryRoot, "packages/flatpack/mosaic-package-release.json")
    const spell = JSON.parse(await readFile(spellPath, "utf8"))
    const flat = JSON.parse(await readFile(flatPath, "utf8"))
    const diagnostics = spell.contributions.find(({ kind }) => kind === "text-diagnostics")
    const raster = flat.contributions.find(({ kind }) => kind === "email-raster-region")
    const spellReasons = diagnostics.completion.reasons
    const flatReasons = raster.completion.reasons
    const writeRelease = async (path, release) => {
      refreshReleaseDigest(release)
      await writeFile(path, `${JSON.stringify(release, null, 2)}\n`)
    }

    assert.deepEqual(spellReasons.map(({ code }) => code), [
      "PACKAGE_TEXT_DIAGNOSTICS_UNRESOLVED",
      "PACKAGE_TEXT_DIAGNOSTICS_INCOMPLETE",
      "PACKAGE_TEXT_DIAGNOSTICS_EXECUTION_FAILED",
    ])
    for (const { code } of spellReasons) {
      diagnostics.completion.reasons = spellReasons.filter((reason) => reason.code !== code)
      await writeRelease(spellPath, spell)
      await assert.rejects(validateRepository(temporaryRoot), new RegExp(`completion reason is missing ${code}`))
    }
    diagnostics.completion.reasons = spellReasons
    diagnostics.completion.reasons[0].message = ""
    await writeRelease(spellPath, spell)
    await assert.rejects(validateRepository(temporaryRoot), /completion reason message is invalid/u)
    diagnostics.completion.reasons[0].message = "Review or resolve the spelling issues highlighted by Spell Check before completing."
    await writeRelease(spellPath, spell)

    assert.deepEqual(flatReasons.map(({ code }) => code), [
      "EMAIL_RASTER_WORKER_FAILED",
      "EMAIL_RASTER_WORKER_PLAN_INVALID",
    ])
    for (const { code } of flatReasons) {
      raster.completion.reasons = flatReasons.filter((reason) => reason.code !== code)
      await writeRelease(flatPath, flat)
      await assert.rejects(validateRepository(temporaryRoot), new RegExp(`completion reason is missing ${code}`))
    }
    raster.completion.reasons = [...flatReasons, {
      code: "EMAIL_RASTER_RENDER_FAILED",
      message: "FlatPack should not claim host rendering failures.",
    }]
    await writeRelease(flatPath, flat)
    await assert.rejects(validateRepository(temporaryRoot), /completion reason is host-owned EMAIL_RASTER_RENDER_FAILED/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
