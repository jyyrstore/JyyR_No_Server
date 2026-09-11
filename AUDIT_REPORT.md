# Jyy'R Number Server — Static Audit

Generated: 2026-09-11T08:33:07

## CI

Created:

`/.github/workflows/ci.yml`

Checks:

- npm ci
- npm run typecheck
- npm run lint
- npm run build

Node.js:

- 22

GitHub Actions permissions:

- contents: read

## Security

Secret files detected: 1

Secret-like findings: 0

Missing .gitignore rules fixed: 0

## Application

API routes: 13

SQL migrations: 5

Provider-before-billing warnings:
- None detected

Migration secret warnings:
- None detected

## Important

This is a static source audit.

Actual runtime validation should be performed by GitHub Actions.
