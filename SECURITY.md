# Security

Report suspected vulnerabilities privately through this repository's
**Security → Report a vulnerability** flow. Do not disclose credentials,
tokens, customer data, raw authored content, private endpoints, or exploit
details in a public issue.

Every Package is untrusted input to Mosaic, including official Packages.
Repository content is parsed and digest-verified but never installed, built, or
executed in Mosaic's main browser or server process. Installed Package UI,
Workers, Package Data, Connector jobs, artifacts, and lifecycle operations
remain constrained by Mosaic's versioned host contracts and authority.

Maintainers must review changes to release descriptors, executable artifacts,
schemas, workflows, and repository governance. CI uses read-only permissions
and SHA-pinned actions. Published releases are immutable.
