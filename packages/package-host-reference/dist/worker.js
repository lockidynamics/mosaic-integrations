if (context.operationId === "reference_package.validate_workspace") {
  const title = input.input?.fields?.["reference_package.note_title"]
  const empty = typeof title !== "string" || title.trim().length === 0
  return {
    diagnostics: empty
      ? [{ code: "REFERENCE_TITLE_REQUIRED", severity: "BLOCKER", message: "A title is required." }]
      : [],
  }
}

if (context.operationId === "reference_package.validate_note") {
  const empty = typeof input.title !== "string" || input.title.trim().length === 0
  return {
    diagnostics: empty
      ? [{ code: "REFERENCE_TITLE_REQUIRED", severity: "BLOCKER", message: "A title is required." }]
      : [],
  }
}

if (context.operationId === "reference_package.output_note") {
  return {
    artifacts: [{
      artifactKind: "reference_package.note_text",
      mediaType: "text/plain; charset=utf-8",
      contentBase64: "UmVmZXJlbmNlIFBhY2thZ2UgT3V0cHV0Cg==",
    }],
  }
}

if (context.operationId === "reference_package.generate_asset") {
  return {
    artifacts: [{
      artifactKind: "reference_package.generated_image",
      mediaType: "image/png",
      contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    }],
  }
}

throw new Error("UNKNOWN_OPERATION")
