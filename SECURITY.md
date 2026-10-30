# Security Policy

## Reporting a Vulnerability

`@delmaredigital/payload-experiments` runs in the request path of consuming sites and writes to their database, so security issues can have significant impact. Please report vulnerabilities privately.

**Preferred:** [GitHub private vulnerability reporting](https://github.com/delmaredigital/payload-experiments/security/advisories/new).

**Alternative:** Email [security@delmaredigital.com](mailto:security@delmaredigital.com).

Include a description and impact, steps to reproduce, affected versions, and any suggested fix.

**Please do not open a public GitHub issue for security vulnerabilities.**

## Scope

In scope:

- Access-control bypasses on experiment, metric, layer or event collections
- Event ingestion abuse (spoofed exposures or conversions, oversized or unbounded writes)
- Information disclosure through the manifest or results endpoints
- Cookie or header handling in the Next.js runtime helpers
- Insecure defaults

Out of scope (report upstream): issues in [Payload CMS](https://github.com/payloadcms/payload), [Next.js](https://github.com/vercel/next.js), [Puck](https://github.com/puckeditor/puck) or transitive dependencies.

## Supported Versions

Pre-1.0: fixes are released against the latest published version only.

## Disclosure

Coordinated disclosure. Once a fix is published we issue a GitHub Security Advisory crediting the reporter with their permission.
