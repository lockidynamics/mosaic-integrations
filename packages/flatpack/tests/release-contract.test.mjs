import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const release = JSON.parse(
  await readFile(new URL("mosaic-package-release.json", root), "utf8")
)

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`

function canonicalJson(value, omitted = new Set()) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  return `{${Object.keys(value)
    .filter((key) => !omitted.has(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

test("FlatPack release descriptor is host-valid and binds every immutable artifact", async () => {
  assert.equal(release.packageKey, "flatpack")
  assert.equal(release.publisherKey, "lockidynamics")
  assert.equal(release.contributions[0].kind, "email-raster-region")
  assert.equal(release.version, "1.2.0")
  assert.equal(release.contributions[0].planContract, "mosaic-email-raster-plan-v2")
  assert.deepEqual(release.contributions[0].authoring, {
    schemaVersion: "mosaic-email-raster-authoring-v1",
    label: "FlatPack",
    accent: "#ff9933",
    icon: "image",
    controls: ["link", "alt"],
    brackets: true,
  })
  for (const artifact of release.artifacts) {
    const bytes = await readFile(new URL(artifact.path, root))
    assert.equal(bytes.byteLength, artifact.byteSize, artifact.path)
    assert.equal(digest(bytes), artifact.digest, artifact.path)
  }
  assert.equal(
    digest(
      new TextEncoder().encode(
        canonicalJson(release, new Set(["$schema", "releaseDigest"]))
      )
    ),
    release.releaseDigest
  )
})
