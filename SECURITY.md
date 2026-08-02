# Security policy

## Reporting a vulnerability

Please do not publish exploitable details in a public issue. Use GitHub's private
vulnerability reporting/security advisory workflow when it is available for this
repository. Otherwise, contact the maintainer privately through the repository's
owner profile and include the affected version, reproduction steps and impact.

Do not include credentials, tokens or personal data in a report.

## Repository hygiene

- Secrets and local credentials must remain outside the repository.
- Generated reports, traces and build output are ignored by `.gitignore`.
- Runtime dependencies are checked in CI with `pnpm audit:prod`.
- Third-party assets and dependencies retain their original licenses; see
  `THIRD_PARTY_NOTICES.md`.
