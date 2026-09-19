# Repository Guidelines

See `CLAUDE.md` for the rules and `docs/design.md` for the product design. Per-directory
`AGENTS.md` files (frontend, mobile) carry the details for that slice.

- **The project is open-source ready.** Assume the source is public when making any decision.
  Never commit secrets, real identifiers (account/project IDs, zone IDs, domains, emails, IPs,
  hostnames), sample genomes or anything that would help an attacker; use placeholders and keep
  real values in gitignored `.env` / `*.tfvars` or GitHub secrets. Never rely on secrecy of the
  code for security (`CLAUDE.md` Rules).
- Read `docs/decisions/` before changing storage, egress or consent behaviour.
- Run `make test` before committing; `make lint` for Biome.
- Legal posture is a feature: any change that sends data off-device needs a consent entry in
  `frontend/src/consent/kinds.ts` and a row in design §13.1.
