import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { chdir } from "node:process"
import { fileURLToPath } from "node:url"
import test from "node:test"
const root = new URL("../", import.meta.url)
const mosaicRoot = new URL("../../../../mosaic/", import.meta.url)
const runtimeUrl = new URL("packages/package-runtime/src/package-worker-runtime.ts", mosaicRoot)
const hostAvailable = await access(runtimeUrl).then(() => true, () => false)
const QuickJsWasiPackageWorkerRuntime = hostAvailable
  ? (await import(runtimeUrl.href)).QuickJsWasiPackageWorkerRuntime
  : null
const worker = await readFile(new URL("dist/worker.js", root), "utf8")
const resource = async (resourceId) => {
  const text = await readFile(new URL(`resources/${resourceId}`, root), "utf8")
  return {
    resourceId,
    mediaType: "text/plain",
    digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    chunks: Array.from({ length: Math.ceil(text.length / 64_000) }, (_, index) =>
      text.slice(index * 64_000, (index + 1) * 64_000)
    ),
  }
}
const resources = await Promise.all([
  resource("spellcheck.en_us.aff"),
  resource("spellcheck.en_us.dic"),
  resource("spellcheck.es_es.aff"),
  resource("spellcheck.es_es.dic"),
])
const suppliedReads = [
  { readId: "spellcheck.global_policy_read", value: { generation: 0, record: null } },
  { readId: "spellcheck.library_policy_read", value: { generation: 0, record: null } },
  { readId: "spellcheck.global_dictionary_read", value: { generation: 0, records: [] } },
  { readId: "spellcheck.library_dictionary_read", value: { generation: 0, records: [] } },
]

if (hostAvailable) chdir(fileURLToPath(mosaicRoot))

const baseRequest = {
  schemaVersion: "mosaic-package-worker-v2",
  release: {
    publisherKey: "lockidynamics",
    packageKey: "spellcheck",
    version: "0.2.0",
    releaseDigest: `sha256:${"a".repeat(64)}`,
  },
  deterministicVersion: "0.2.0",
  suppliedReads,
  resources,
  limits: {
    cpuMilliseconds: 10_000,
    wallMilliseconds: 15_000,
    memoryBytes: 128_000_000,
    stackBytes: 500_000,
    inputBytes: 1_000_000,
    inputDepth: 32,
    inputNodes: 20_000,
    outputBytes: 2_000_000,
    outputDepth: 32,
    outputNodes: 20_000,
    diagnostics: 100,
  },
}

test("runs diagnostics through Mosaic's real isolated Worker runtime", { skip: !hostAvailable }, async () => {
  const runtime = new QuickJsWasiPackageWorkerRuntime()
  const response = await runtime.execute({
    source: worker,
    request: {
      ...baseRequest,
      invocationId: "spellcheck_runtime_0001",
      operationId: "spellcheck.check",
      inputSchemaId: "spellcheck.diagnostic_input.v2",
      resultSchemaId: "spellcheck.diagnostic_result.v2",
      input: {
        schemaVersion: "mosaic-text-diagnostics-input-v2",
        sources: [{ sourceId: "body", revision: "r1", text: "hello helooo" }],
        packageState: null,
      },
    },
  })
  assert.equal(response.ok, true)
  assert.equal(response.result.complete, true, JSON.stringify(response.result))
  assert.equal(response.result.diagnostics[0].word, "helooo")
})

test("runs package-owned native mutation planning in the same sandbox", { skip: !hostAvailable }, async () => {
  const runtime = new QuickJsWasiPackageWorkerRuntime()
  const response = await runtime.execute({
    source: worker,
    request: {
      ...baseRequest,
      resources: [],
      invocationId: "spellcheck_runtime_0002",
      operationId: "spellcheck.diagnostic_action",
      inputSchemaId: "spellcheck.action_input.v1",
      resultSchemaId: "spellcheck.command_result.v1",
      input: {
        schemaVersion: "mosaic-text-diagnostics-action-v1",
        actionId: "spellcheck.add_global",
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
    },
  })
  assert.equal(response.ok, true)
  assert.equal(response.result.kind, "package-scoped-data-create")
  assert.equal(response.result.scope, "global")
  assert.equal(response.result.recordTypeId, "spellcheck.global_dictionary")
})
