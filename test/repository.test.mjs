import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import { validateRepository } from "../scripts/validate-repository.mjs"

const root = resolve(import.meta.dirname, "..")

test("the official repository contains valid independent Package Releases", async () => {
  assert.deepEqual(await validateRepository(root), [
    {
      slug: "reference-package",
      packageKey: "reference_package",
      version: "1.1.0",
    },
  ])
})

test("tampered release artifacts and release identities fail closed", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "mosaic-integrations-test-"))
  try {
    await cp(root, temporaryRoot, {
      recursive: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    })
    const worker = resolve(temporaryRoot, "packages/package-host-reference/dist/worker.js")
    await writeFile(worker, `${await readFile(worker, "utf8")}\n`)
    await assert.rejects(validateRepository(temporaryRoot), /artifact byte size mismatch/u)

    await cp(root, temporaryRoot, {
      recursive: true,
      force: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    })
    const releasePath = resolve(
      temporaryRoot,
      "packages/package-host-reference/mosaic-package-release.json"
    )
    const release = JSON.parse(await readFile(releasePath, "utf8"))
    release.releaseDigest = `sha256:${"0".repeat(64)}`
    await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`)
    await assert.rejects(validateRepository(temporaryRoot), /release digest mismatch/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
