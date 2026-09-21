#!/usr/bin/env node

import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const VERSION = /^(0|[1-9][0-9]{0,14})\.(0|[1-9][0-9]{0,14})\.(0|[1-9][0-9]{0,14})$/u
const KEY = /^[a-z][a-z0-9_]{0,63}$/u
const ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SHA256 = /^sha256:[0-9a-f]{64}$/u
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u

export async function validateRepository(root) {
  const packagesRoot = resolve(root, "packages")
  const entries = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
  check(entries.length > 0 && entries.length <= 20, "repository must contain 1-20 packages")

  const slugs = new Set()
  const packageKeys = new Set()
  const results = []
  for (const entry of entries) {
    const result = await validatePackage(resolve(packagesRoot, entry.name))
    unique(slugs, result.slug, "catalog slug")
    unique(packageKeys, result.packageKey, "package key")
    results.push(result)
  }
  return Object.freeze(results)
}

async function validatePackage(root) {
  const catalog = await readJson(root, "mosaic-package.json")
  const release = await readJson(root, "mosaic-package-release.json")
  check(SLUG.test(catalog.slug ?? ""), "invalid catalog slug")
  check(VERSION.test(catalog.version ?? ""), "invalid catalog version")
  check(catalog.version === release.version, "catalog and release versions differ")
  check(catalog.slug === release.catalogSlug, "catalog and release slugs differ")
  check(
    typeof catalog.homepage === "string" &&
      catalog.homepage.startsWith("https://github.com/lockidynamics/mosaic-integrations/"),
    "catalog homepage must use the official repository"
  )
  check(release.schemaVersion === "mosaic-package-release-v2", "unsupported release schema")
  check(release.hostContract === "mosaic-package-host-v1", "unsupported host contract")
  check(release.publisherKey === "lockidynamics", "invalid official publisher")
  check(KEY.test(release.packageKey ?? ""), "invalid package key")
  check(VERSION.test(release.version ?? ""), "invalid release version")
  check(SHA256.test(release.releaseDigest ?? ""), "invalid release digest")

  const artifacts = new Map()
  for (const artifact of bounded(release.artifacts, 1, 256, "artifacts")) {
    check(SAFE_PATH.test(artifact.path ?? ""), `unsafe artifact path ${artifact.path}`)
    check(!artifacts.has(artifact.path), `duplicate artifact path ${artifact.path}`)
    check(SHA256.test(artifact.digest ?? ""), `invalid artifact digest ${artifact.path}`)
    const bytes = await readBytes(root, artifact.path, 100_000_000)
    check(bytes.byteLength === artifact.byteSize, `artifact byte size mismatch ${artifact.path}`)
    check(digest(bytes) === artifact.digest, `artifact digest mismatch ${artifact.path}`)
    artifacts.set(artifact.path, artifact)
    if (artifact.kind === "schema") await readJson(root, artifact.path)
  }

  const requiredArtifacts = [
    release.interfaces?.uiBridge?.bundlePath,
    release.interfaces?.worker?.artifactPath,
  ].filter(Boolean)
  for (const path of requiredArtifacts)
    check(artifacts.has(path), `interface artifact is undeclared ${path}`)

  const capabilities = new Set()
  for (const capability of bounded(release.capabilities, 0, 128, "capabilities")) {
    check(
      ID.test(capability.id ?? "") && capability.id.startsWith(`${release.packageKey}.`),
      `invalid capability ${capability.id}`
    )
    unique(capabilities, capability.id, "capability")
  }
  const contributions = new Set()
  for (const contribution of bounded(release.contributions, 1, 128, "contributions")) {
    check(
      ID.test(contribution.id ?? "") && contribution.id.startsWith(`${release.packageKey}.`),
      `invalid contribution ${contribution.id}`
    )
    unique(contributions, contribution.id, "contribution")
    if (contribution.requiredCapabilityId !== null)
      check(
        capabilities.has(contribution.requiredCapabilityId),
        `unknown capability ${contribution.requiredCapabilityId}`
      )
  }

  const roles = await readOptionalJson(root, "roles.json")
  if (roles) {
    check(roles.schemaVersion === "mosaic-package-roles-v1", "invalid roles schema")
    const roleTypes = new Set()
    for (const suggestion of bounded(roles.suggestions, 0, 3, "role suggestions")) {
      check(["builder", "editor", "reviewer"].includes(suggestion.roleType), "invalid role suggestion")
      unique(roleTypes, suggestion.roleType, "role suggestion")
      for (const capabilityId of bounded(suggestion.capabilityIds, 1, 64, "role capabilities"))
        check(capabilities.has(capabilityId), `roles.json references ${capabilityId}`)
    }
  }

  const changelog = await readText(root, "CHANGELOG.md", 262_144)
  check(
    changelog.includes(`## ${release.version}`) ||
      changelog.includes(`## [${release.version}]`),
    "changelog is missing the release version"
  )
  check(digest(canonicalJson(release, new Set(["$schema", "releaseDigest"]))) === release.releaseDigest, "release digest mismatch")
  return Object.freeze({ slug: catalog.slug, packageKey: release.packageKey, version: release.version })
}

function bounded(value, minimum, maximum, label) {
  check(Array.isArray(value) && value.length >= minimum && value.length <= maximum, `${label} must contain ${minimum}-${maximum} entries`)
  return value
}

function unique(values, value, label) {
  check(!values.has(value), `duplicate ${label} ${value}`)
  values.add(value)
}

async function readOptionalJson(root, path) {
  try {
    return await readJson(root, path)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function readJson(root, path) {
  return JSON.parse(await readText(root, path, 262_144))
}

async function readText(root, path, maximum) {
  return readFile(await regularFile(root, path, maximum), "utf8")
}

async function readBytes(root, path, maximum) {
  return readFile(await regularFile(root, path, maximum))
}

async function regularFile(root, path, maximum) {
  check(typeof path === "string" && SAFE_PATH.test(path), `unsafe path ${path}`)
  const file = resolve(root, path)
  check(file.startsWith(`${resolve(root)}${sep}`), `path escapes package ${path}`)
  const info = await lstat(file)
  check(info.isFile() && !info.isSymbolicLink(), `not a regular file ${path}`)
  check((await stat(file)).size <= maximum, `file is too large ${path}`)
  check((await realpath(file)).startsWith(`${await realpath(root)}${sep}`), `path escapes package ${path}`)
  return file
}

function canonicalJson(value, omitted = new Set()) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  return `{${Object.keys(value)
    .filter((key) => !omitted.has(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function check(condition, message) {
  if (!condition) throw new Error(`MOSAIC_PACKAGE_INVALID: ${message}`)
}

const executed = process.argv[1] ? resolve(process.argv[1]) : null
if (executed === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const packages = await validateRepository(root)
  console.log(`Validated ${packages.map(({ packageKey, version }) => `${packageKey}@${version}`).join(", ")}.`)
}
