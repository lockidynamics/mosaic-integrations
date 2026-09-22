import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const workerSource = await readFile(new URL("dist/worker.js", root), "utf8")
const request = JSON.parse(
  await readFile(new URL("tests/fixtures/plan-request.json", root), "utf8")
)
const source = JSON.parse(
  await readFile(new URL("tests/fixtures/source.json", root), "utf8")
)

function run(input, operationId = "flatpack.rasterize_region") {
  return Function("input", "context", workerSource)(input, { operationId })
}

test("FlatPack Worker returns a deterministic plan for all four presentation variants and resolved states", () => {
  const result = run(request)
  assert.deepEqual(result, {
    schemaVersion: "mosaic-email-raster-plan-v2",
    kind: "rasterize-region",
    regionId: "hero-region",
    sourceChecksum: request.sourceChecksum,
    states: request.states,
    variants: [
      "desktop-light",
      "desktop-dark",
      "mobile-light",
      "mobile-dark",
    ],
  })
  assert.equal(JSON.stringify(run(request)), JSON.stringify(run(request)))
})

test("FlatPack Worker omits dark variants when Library governance disables Dark Mode", () => {
  assert.deepEqual(run({ ...request, darkModeEnabled: false }).variants, [
    "desktop-light",
    "mobile-light",
  ])
})

test("FlatPack Worker rejects altered or non-canonical source state input", () => {
  assert.throws(() => run({ ...request, sourceChecksum: "sha256:bad" }), /INVALID_INPUT/u)
  assert.throws(() => run({ ...request, darkModeEnabled: undefined }), /INVALID_INPUT/u)
  assert.throws(
    () => run({ ...request, states: [{ ...request.states[0], selectionKey: '{"variationId":null,"moduleInstanceId":"module_hero"}' }] }),
    /NON_CANONICAL_SELECTION/u
  )
  assert.throws(() => run(request, "flatpack.other_operation"), /UNKNOWN_OPERATION/u)
})

test("FlatPack plans accept the full bounded 100-member canonical region", async () => {
  const selectionKey = JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
    moduleInstanceId: String(index).padStart(32, "0"),
    variationId: "a".repeat(32),
  })))
  assert.ok(selectionKey.length > 4096)
  const input = { ...request, states: [{ ...request.states[0], selectionKey }] }
  assert.equal(run(input).states[0].selectionKey, selectionKey)
})

test("FlatPack Worker has no package-owned host escape surface", () => {
  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "process.",
    "require(",
    "import(",
    "document",
    "window",
    "Prisma",
    "SQL",
    "secret",
  ])
    assert.equal(workerSource.includes(forbidden), false, forbidden)
})

test("FlatPack package files are rooted at the package directory", async () => {
  assert.match(root.pathname, /\/packages\/flatpack\/$/u)
  assert.match(workerSource, /mosaic-email-raster-plan-request-v2/u)
  assert.match(workerSource, /desktop-light/u)
  assert.match(workerSource, /mobile-dark/u)
})

test("FlatPack schemas validate the real source and worker plan fixtures", async () => {
  for (const name of [
    "flatpack.email_raster_source_v1.schema.json",
    "flatpack.email_raster_plan_request_v2.schema.json",
    "flatpack.email_raster_plan_v2.schema.json",
  ]) {
    const schema = JSON.parse(await readFile(new URL(`schemas/${name}`, root), "utf8"))
    assert.equal(schema.type, "object")
    assert.ok(schema.properties)
  }
  assert.equal(source.hostContract, "mosaic-email-raster-regions-v1")
  assert.equal(request.schemaVersion, "mosaic-email-raster-plan-request-v2")
  assert.equal(run(request).schemaVersion, "mosaic-email-raster-plan-v2")
})
