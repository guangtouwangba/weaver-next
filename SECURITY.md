# Security Policy

## Supported versions

Weaver is in early development. Security fixes are applied to the latest release only.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository. Include the affected version, reproduction steps, impact, and any suggested mitigation.

We aim to acknowledge a report within seven days. Timelines for a fix or disclosure depend on severity and reproducibility.

## Security boundaries

Weaver is local-first. Project state lives under each workspace's `.weaver/` directory. The MCP loopback server binds to `127.0.0.1`, uses a random token, confines file access to the selected workspace, and keeps agent writes behind audited ChangeSets and revision checks.

Never attach `.weaver/` databases, logs, environment files, access tokens, or private source material to a public issue without redacting them.
