# Worktree development

## Contract

- SuPi is a pnpm workspace of TypeScript extensions loaded directly from source; no application build or development server is required.
- `orca.yaml` selects `scripts/worktree-setup.sh`, `scripts/worktree-archive.sh`, and `wait-for-setup` agent startup.
- Setup reuses `pnpm install --frozen-lockfile` and the existing Tree-sitter `check:all-wasm` command. It also checks local TypeScript and Vitest executables.
- Setup success means these dependency/tool/WASM checks passed, not that all tests or live extension loading passed.
- Setup starts no background processes, services, supervisors, databases, migrations, or seeds. There are no service URLs, origins, port allocations, reservations, or persistent application instances to locate or stop.
- The canonical checkout path identifies the target. No branch-derived state is stored, so retries and branch renames do not allocate or adopt resources. Archive is non-destructive even for a replacement checkout: it has no prior-generation resources to release.
- No environment files, credentials, dependency trees, or user Pi settings are copied from another checkout. Use each tool's existing user authentication/configuration when needed; setup does not regenerate it.
- Archive deliberately leaves dependencies, build artifacts, caches, local files, and user data untouched. The caller owns later checkout removal; neither script commits, switches branches, or changes Git refs.

## Prerequisites

| Requirement | Source / check |
| --- | --- |
| Node.js | `.mise.toml` selects LTS; CI uses Node 24 |
| pnpm | Exact `packageManager` version in root `package.json`; also pinned in `.mise.toml` |
| Git and Bash | Available on `PATH`; target must be a workspace checkout root |
| Dependency access | pnpm registry/store access and package install prerequisites; CI setup is `.github/actions/setup-pnpm/action.yml` |
| Vendored grammars | `pnpm --filter @mrclrchtr/supi-tree-sitter check:all-wasm` |

Do not install shared Git hooks from per-worktree setup: linked worktrees share Git configuration. Developers can separately install hooks using the existing `.mise.toml` task when the pinned tools are available.

## Manual operation

Both scripts work without Orca or Worktrunk. From any ordinary shell:

```sh
/path/to/checkout/scripts/worktree-setup.sh /path/to/checkout
/path/to/checkout/scripts/worktree-archive.sh /path/to/checkout
```

Target selection: one explicit argument, otherwise `ORCA_WORKTREE_PATH` if set, otherwise the checkout containing the script. An explicit target wins over Orca environment variables. Setup may be rerun after a partial install; it never rewrites the lockfile or overwrites local configuration files. Archive is idempotent and starts/stops nothing.

## Validation and diagnostics

```sh
bash -n scripts/worktree-setup.sh scripts/worktree-archive.sh
pnpm vitest run scripts/__tests__/worktree-lifecycle.test.mjs --reporter=agent
pnpm verify:ai
```

- Setup reports the failed step and exits nonzero. Correct the Node/pnpm version, registry access, install failure, or reported WASM mismatch, then rerun against the same checkout. Do not bypass frozen-lockfile or regenerate grammar assets merely to hide a failure.
- Read command output in the invoking shell or Orca Setup terminal; there is no separate application log or console.
- Read `pnpm run` for existing test, watch, typecheck, packaging, and grammar commands. Validation processes started manually remain the developer's responsibility, not archive-owned services.
- Portable adapter tests use disposable repositories and a fake pnpm to check arguments, repeatability, and failure propagation. They do not prove package installation or native Orca lifecycle behavior.

## Native Orca operation and proof boundaries

- Primary checkout `orca.yaml` supplies archive configuration; the target checkout's YAML supplies setup configuration. Commands execute in the target checkout.
- Commit the intended YAML and scripts in an approved base before creating worktrees from it. An uncommitted primary file is not present in a fresh checkout of the old HEAD. A commit requires separate authorization.
- Empty local setup/archive commands fall back to shared hooks when no hook-source override selects otherwise. A local nonempty hook can mask YAML; `run-both` can execute duplicate work. Inspect the registered primary with `orca repo show --repo id:<repo-id> --json` before relying on defaults.
- `--setup inherit` follows native policy; `--setup run` requests the selected hook. It does not select shared YAML over a local hook. Archive during native removal requires `--run-hooks`; a failed archive must block removal rather than be waived.
- The current public CLI does not expose a hook-source/startup-policy setter. Do not edit private Orca settings or substitute a different backend to activate hooks. If local settings mask YAML, report the conflict for operator resolution.
- `wait-for-setup` gates agent startup on script completion. A Setup terminal or launch receipt alone is not readiness proof.
- **Prepared** means files and executable entry points exist. **Active** requires public evidence of intended primary/target hook selection and startup policy. **Verified** requires an authorized native lifecycle probe from a base containing the intended configuration. Static YAML parsing and manual setup are narrower evidence.
