# pi-secret-drop

A [pi](https://pi.dev) extension that lets the agent put secrets into files and commands without ever seeing them.

1. The agent calls `secret_drop` with a destination and a placement.
2. Pi opens a masked dialog that shows exactly where the value will go and the command that will apply it. The user types or pastes the secret.
3. The value is staged in `~/.pi/agent/secret-drop/staging/` (mode 600), and pi pre-fills a `!` command in the user's prompt:

   ```
   ! node ~/.pi/agent/npm/node_modules/pi-secret-drop/bin/apply.mjs env ./.env DB_PASSWORD --from ~/.pi/agent/secret-drop/staging/64770-948e1cb74b5a
   ```

4. The user reviews it and presses Enter. The apply script writes the destination, deletes the staged file, and prints only a report:

   ```
   ✓ secret-drop: updated DB_PASSWORD (1 line) in ./.env (env DB_PASSWORD, mode 644) — length check passed (28 chars)
   ```

5. The tool, which has been waiting, returns that report and the agent continues.

The agent never opens the destination: the user runs the write with a command they can read. That also keeps secret-guarding extensions such as [cc-safety-net](https://github.com/kenryu42/cc-safety-net) in charge of the agent's tool calls, since pi's `!` commands are the user's own.

```
╭─ Secret Drop ──────────────────────────────────────────────────╮
│ DB_PASSWORD                                                    │
│                                                                │
│ Into      ./.env (env DB_PASSWORD)                             │
│ Then run  ! node …/apply.mjs env ./.env DB_PASSWORD --from     │
│           ~/.pi/agent/secret-drop/staging/64770-948e1cb74b5a   │
│                                                                │
│ › ••••••••••••••••••••••••••••                                 │
│ 28 chars                                                       │
│                                                                │
│ Enter stage · Esc cancel · Ctrl+R show/hide · Ctrl+U clear     │
╰────────────────────────────────────────────────────────────────╯
```

## Install

```bash
pi install npm:pi-secret-drop
```

The package ships the extension and a `secret-drop` skill that teaches the agent to use it and to let programs consume secret files.

### Recommended: pair with cc-safety-net

Use pi-secret-drop together with [cc-safety-net](https://github.com/kenryu42/cc-safety-net) ([pi installation](https://ccsafetynet.com/docs/installation#pi-installation)):

```bash
pi install npm:cc-safety-net
```

The two cover different halves of the problem:

- **cc-safety-net keeps the agent out of secrets that already exist.** It blocks the agent's shell and file tools from reading `.env` files, SSH keys, `~/.aws`, and other well-known credential locations, whether or not pi-secret-drop wrote them.
- **pi-secret-drop gets new secrets in without the agent seeing them.** It protects the destinations it writes, including files outside cc-safety-net's patterns such as `config.yml`, and redacts the values from tool output.

They do not conflict. cc-safety-net inspects the agent's tool calls; the apply command is the user's own `!` command, so the write goes through while the agent stays blocked from reading the result.

## Tool: `secret_drop`

| Parameter | Meaning |
|---|---|
| `label` | What the user should enter. |
| `format` | `env`, `regex`, `file`, or `command`. Defaults to `env` when `key` is set, `command` when `command` is set, else `file`. |
| `destination` | `env` / `regex` / `file`: target file, relative to the working directory. Missing directories are created. |
| `key`, `quote` | `env`: variable name and quoting (`auto`, `none`, `single`, `double`). Existing `KEY=` / `export KEY=` lines are replaced; otherwise the line is appended. |
| `regex`, `flags` | `regex`: replaces capture group 1, or the whole match, in an existing file. `g` replaces every match. |
| `fileMode` | Octal permissions. New files default to `600`; existing files keep their mode. |
| `command` | `command`: shell command reading the staged file `{secret}`, e.g. `ansible-vault encrypt_string --stdin-name db_password < {secret} >> vault.yml`. Stdout is discarded; stderr is shown with the value redacted when the command fails. |

Writes are atomic (temp file + rename) and verified by re-reading the destination. The staged file is overwritten and deleted after every apply attempt, and when the tool is cancelled or aborted. Staged files left by pi processes that have exited are removed at session start.

## Protection after the write

- **Blocked reads.** `read`, `edit`, `write`, and `grep` on a destination or the staging area are blocked, as are bash commands that print, copy, or open them (`cat`, `head`, `grep`, `sed`, `cp`, `base64`, `< file`, …). Commands that only pass the path to a consumer still run.
- **Redaction.** Any tool result or context message containing a secret value is rewritten to `[REDACTED]`. Values are reloaded from protected destinations at session start.
- **Registry.** Protected locations (never values) live in `~/.pi/agent/secret-drop/registry.json`. `/secret-drop` lists them; `/secret-drop forget <path>` removes one.

## Limits

- Requires the interactive terminal UI. In RPC, JSON, and print modes the tool fails instead of falling back to a plain-text prompt.
- The bash guard matches command tokens against protected paths. It stops accidental reads, not a determined agent: an indirect path (a variable, a glob, a script that prints the file) passes through. Redaction is the second layer for that output.
- Values shorter than 4 characters are not redacted. Values applied with `format: "command"` are redacted for the rest of the session only.
- The apply command is shown before it runs; review it, since a `command` can send the staged value anywhere.

## Development

```bash
npm install
npm run check   # tsc --noEmit, including the JSDoc-typed lib/ and bin/
npm test        # node --test
```

`lib/` and `bin/` are plain JavaScript so the apply script runs with `node` from an npm install, where Node does not strip TypeScript types.

Releases publish from GitHub Actions through npm trusted publishing: bump `version` in `package.json`, commit, and push a matching `v<version>` tag.

## License

MIT
