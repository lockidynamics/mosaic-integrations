#!/usr/bin/env node

import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"

const VERSION = /^(0|[1-9][0-9]{0,14})\.(0|[1-9][0-9]{0,14})\.(0|[1-9][0-9]{0,14})$/u
const KEY = /^[a-z][a-z0-9_]{0,63}$/u
const ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SHA256 = /^sha256:[0-9a-f]{64}$/u
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u

export async function validateRepository(root) {
  const releaseSchema = await readFile(resolve(root, "schemas/mosaic-package-release-v2.schema.json"), "utf8")
  const validateReleaseSchema = new Ajv2020({ strict: false }).compile(JSON.parse(releaseSchema))
  const catalogSchema = await readFile(resolve(root, "schemas/mosaic-package.schema.json"), "utf8")
  const validateCatalogSchema = new Ajv2020({ strict: false }).compile(JSON.parse(catalogSchema))
  const packagesRoot = resolve(root, "packages")
  const entries = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
  check(entries.length > 0 && entries.length <= 20, "repository must contain 1-20 packages")

  const slugs = new Set()
  const packageKeys = new Set()
  const results = []
  for (const entry of entries) {
    const result = await validatePackage(resolve(packagesRoot, entry.name), validateCatalogSchema, validateReleaseSchema)
    unique(slugs, result.slug, "catalog slug")
    unique(packageKeys, result.packageKey, "package key")
    results.push(result)
  }
  return Object.freeze(results)
}

async function validatePackage(root, validateCatalogSchema, validateReleaseSchema) {
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

  const worker = release.interfaces?.worker
  if (worker?.version === "mosaic-package-worker-v2") {
    const resourceIds = new Set()
    for (const resource of bounded(worker.resources, 1, 128, "worker resources")) {
      check(ID.test(resource.resourceId ?? "") && resource.resourceId.startsWith(`${release.packageKey}.`), `invalid worker resource ${resource.resourceId}`)
      unique(resourceIds, resource.resourceId, "worker resource")
      check(artifacts.get(resource.artifactPath)?.kind === "data", `worker resource is not data ${resource.resourceId}`)
    }
    for (const contribution of release.contributions ?? []) {
      if (contribution.kind !== "text-diagnostics") continue
      for (const locale of bounded(contribution.locales, 1, 32, "diagnostic locales"))
        for (const resourceId of bounded(locale.resourceIds, 1, 16, "locale resources"))
          check(resourceIds.has(resourceId), `diagnostic locale references unknown resource ${resourceId}`)
    }
  }
  for (const record of release.interfaces?.data?.records ?? []) {
    check(artifacts.has(`schemas/${record.schemaId}.schema.json`), `data record schema is undeclared ${record.schemaId}`)
    if (record.mode === "settings-record") {
      check(release.interfaces?.data?.version === "mosaic-package-data-v2", `settings record requires data v2 ${record.id}`)
      check(record.scope === "global" || record.scope === "library", `settings record scope is invalid ${record.id}`)
      check(record.recordIdMode === "fixed" || record.recordIdMode === "generated", `settings record id mode is invalid ${record.id}`)
      check(Number.isSafeInteger(record.maxRecords) && record.maxRecords >= 1 && record.maxRecords <= 10_000, `settings record max records is invalid ${record.id}`)
      if (record.recordIdMode === "fixed") {
        check(typeof record.recordId === "string" && record.recordId.length > 0 && record.maxRecords === 1, `fixed settings record is invalid ${record.id}`)
      } else check(record.recordId === undefined, `generated settings record cannot declare a record id ${record.id}`)
    }
  }

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
    if (contribution.kind === "text-diagnostics") {
      check(["mosaic-text-diagnostics-v1", "mosaic-text-diagnostics-v2"].includes(contribution.diagnosticsVersion), "invalid text diagnostics version")
      check(Array.isArray(contribution.locales) && contribution.locales.length > 0, "text diagnostics locales are missing")
      check(artifacts.has(`schemas/${contribution.inputSchemaId}.schema.json`), "text diagnostics input schema is undeclared")
      check(artifacts.has(`schemas/${contribution.resultSchemaId}.schema.json`), "text diagnostics result schema is undeclared")
      if (contribution.diagnosticsVersion === "mosaic-text-diagnostics-v2") {
        check(Array.isArray(contribution.scopedDataReads), "text diagnostics scoped reads are missing")
        check(contribution.enforcement && typeof contribution.enforcement.booleanField === "string", "text diagnostics enforcement is missing")
        check(contribution.presentation && Array.isArray(contribution.presentation.actions), "text diagnostics presentation is missing")
        validateCompletion(
          contribution,
          [
            "PACKAGE_TEXT_DIAGNOSTICS_UNRESOLVED",
            "PACKAGE_TEXT_DIAGNOSTICS_INCOMPLETE",
            "PACKAGE_TEXT_DIAGNOSTICS_EXECUTION_FAILED",
          ],
          null
        )
      }
    }
    if (contribution.kind === "email-raster-region")
      validateCompletion(
        contribution,
        ["EMAIL_RASTER_WORKER_FAILED", "EMAIL_RASTER_WORKER_PLAN_INVALID"],
        new Set(["EMAIL_RASTER_WORKER_FAILED", "EMAIL_RASTER_WORKER_PLAN_INVALID"])
      )
    if (contribution.kind === "native-surface") {
      if (contribution.evaluationOperation)
        validateCompletion(
          contribution,
          [
            "PACKAGE_NATIVE_EVALUATION_EXECUTION_FAILED",
            "PACKAGE_NATIVE_EVALUATION_BINDING_MISMATCH",
          ],
          null
        )
      else check(contribution.completion === undefined, "native completion requires evaluation operation")
    }
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
  check(validateCatalogSchema(catalog), `catalog schema mismatch ${validateCatalogSchema.errors?.[0]?.instancePath ?? ""}`)
  check(validateReleaseSchema(release), `release schema mismatch ${validateReleaseSchema.errors?.[0]?.instancePath ?? ""}`)
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

function validateCompletion(contribution, requiredCodes, allowedCodes) {
  const completion = contribution.completion
  check(completion && typeof completion === "object" && !Array.isArray(completion), `completion is missing ${contribution.id}`)
  check(typeof completion.label === "string" && completion.label.length >= 1 && completion.label.length <= 100, `completion label is invalid ${contribution.id}`)
  check(typeof completion.stageLabel === "string" && completion.stageLabel.length >= 1 && completion.stageLabel.length <= 100, `completion stage label is invalid ${contribution.id}`)
  const codes = new Set()
  for (const reason of bounded(completion.reasons, 1, 64, `completion reasons ${contribution.id}`)) {
    check(typeof reason?.code === "string" && /^[A-Z][A-Z0-9_.-]{1,127}$/u.test(reason.code), `completion reason code is invalid ${contribution.id}`)
    check(typeof reason?.message === "string" && reason.message.length >= 1 && reason.message.length <= 240, `completion reason message is invalid ${contribution.id}`)
    unique(codes, reason.code, `completion reason ${contribution.id}`)
    if (allowedCodes) check(allowedCodes.has(reason.code), `completion reason is host-owned ${reason.code}`)
  }
  for (const code of requiredCodes)
    check(codes.has(code), `completion reason is missing ${code}`)
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
