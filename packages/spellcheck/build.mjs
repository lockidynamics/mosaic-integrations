import { build } from "esbuild"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { resolve } from "node:path"

const root = new URL(".", import.meta.url)
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const resources = [
  ["en-US", "dictionary-en", "spellcheck.en_us"],
  ["es-ES", "dictionary-es", "spellcheck.es_es"],
]
await mkdir(new URL("dist/", root), { recursive: true })
const body = (await readFile(new URL("src/worker.js", root), "utf8"))
  .replace(/^import nspell from "nspell"\n\n/u, "")
const result = await build({
  stdin: {
    contents: `import nspell from "nspell"; globalThis.spellcheckWorker = (input, context) => {\n${body}\n}`,
    resolveDir: new URL(".", root).pathname,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  write: false,
})
await writeFile(
  new URL("dist/worker.js", root),
  `${result.outputFiles[0].text}\nreturn globalThis.spellcheckWorker(input, context);\n`
)
for (const [, packageName, prefix] of resources) {
  for (const extension of ["aff", "dic"]) {
    const bytes = await readFile(new URL(`node_modules/${packageName}/index.${extension}`, root))
    await writeFile(new URL(`resources/${prefix}.${extension}`, root), bytes)
  }
}

const releasePath = new URL("mosaic-package-release.json", root)
const release = JSON.parse(await readFile(releasePath, "utf8"))
release.artifacts = await Promise.all(release.artifacts.map(async (artifact) => {
  const bytes = await readFile(new URL(artifact.path, root))
  return { ...artifact, byteSize: bytes.byteLength, digest: digest(bytes) }
}))
const canonical = (value, omitted = new Set()) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map((item) => canonical(item)).join(",")}]`
      : `{${Object.keys(value).filter((key) => !omitted.has(key)).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
release.releaseDigest = digest(Buffer.from(canonical(release, new Set(["$schema", "releaseDigest"]))))
await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`)
