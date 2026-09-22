const PLAN_SCHEMA = "mosaic-email-raster-plan-v2"
const REQUEST_SCHEMA = "mosaic-email-raster-plan-request-v2"

if (context.operationId !== "flatpack.rasterize_region")
  throw new Error("UNKNOWN_OPERATION")

if (
  !input ||
  typeof input !== "object" ||
  Array.isArray(input) ||
  input.schemaVersion !== REQUEST_SCHEMA ||
  typeof input.regionId !== "string" ||
  typeof input.sourceChecksum !== "string" ||
  !/^sha256:[a-f0-9]{64}$/.test(input.sourceChecksum) ||
  !Number.isSafeInteger(input.desktopWidthPx) ||
  input.desktopWidthPx < 1 ||
  !Number.isSafeInteger(input.mobileWidthPx) ||
  input.mobileWidthPx < 1 ||
  typeof input.darkModeEnabled !== "boolean" ||
  !Array.isArray(input.states) ||
  input.states.length < 1 ||
  input.states.length > 64
)
  throw new Error("INVALID_INPUT")

const states = input.states.map((state) => {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    typeof state.selectionKey !== "string" ||
    state.selectionKey.length < 2 ||
    state.selectionKey.length > 32768 ||
    typeof state.sourceDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(state.sourceDigest) ||
    typeof state.empty !== "boolean"
  )
    throw new Error("INVALID_STATE")
  const selection = JSON.parse(state.selectionKey)
  if (stableJson(selection) !== state.selectionKey)
    throw new Error("NON_CANONICAL_SELECTION")
  return {
    selectionKey: state.selectionKey,
    sourceDigest: state.sourceDigest,
    empty: state.empty,
  }
})

return {
  schemaVersion: PLAN_SCHEMA,
  kind: "rasterize-region",
  regionId: input.regionId,
  sourceChecksum: input.sourceChecksum,
  states,
  variants: input.darkModeEnabled
    ? ["desktop-light", "desktop-dark", "mobile-light", "mobile-dark"]
    : ["desktop-light", "mobile-light"],
}

function stableJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("INVALID_JSON")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`
  throw new Error("INVALID_JSON")
}
