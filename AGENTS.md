# Repository Guidelines

See `CLAUDE.md` for the rules and `docs/design.md` for the product design. Per-directory
`AGENTS.md` files (frontend, backend) carry the details for that slice.

- Read `docs/decisions/` before changing storage, egress or consent behaviour.
- Run `make test` before committing; `make lint` for Biome + gofmt.
- Legal posture is a feature: any change that sends data off-device needs a consent entry in
  `frontend/src/consent/kinds.ts` and a row in design §13.1.
