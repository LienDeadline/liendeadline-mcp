# Security policy

Report security issues privately to [support@liendeadline.com](mailto:support@liendeadline.com),
not in public issues or pull requests. Include the affected release or file, what an attacker
could do with it, and steps to reproduce.

## Scope

- This repository: the `liendeadline-mcp` npm package, the `.mcpb` bundles and the hosted
  endpoint at `https://mcp.liendeadline.com/mcp`.
- LienDeadline's API at `secure-api-v1.liendeadline.com`, which the tools call. Report issues
  there to the same address.

Examples include a way to make the server send a customer key anywhere other than the production
API, to read another user's data, or to get a tool to change anything. Every tool is meant to
be read-only.

## Supported versions

Fixes land on `main` and ship in the next release. Only the latest release is supported.
Dependency security fixes reach `npx` users through a new release, because the package ships
`npm-shrinkwrap.json`.
