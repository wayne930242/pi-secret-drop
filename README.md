# pi-secret-drop

A [pi](https://pi.dev) extension that lets the agent put secrets into files and commands without ever seeing them.

1. The agent calls `secret_drop` with a destination, a placement, and the steps to get the secret.
2. Pi opens a masked dialog that shows those steps, where the value will go, and what happens next. The user types or pastes the secret, or presses Tab to ask the agent a question instead.
3. The value is staged in `~/.pi/agent/secret-drop/staging/` (mode 600), and pi pre-fills a `!` command in the user's prompt:

   ```
   ! node ~/.pi/agent/npm/node_modules/pi-secret-drop/dist/apply.js env ./.env DB_PASSWORD --from ~/.pi/agent/secret-drop/staging/64770-948e1cb74b5a
   ```

4. The user reviews it and presses Enter. The apply script writes the destination, deletes the staged file, and prints only a report:

   ```
   ✓ secret-drop: updated DB_PASSWORD (1 line) in ./.env (env DB_PASSWORD, mode 644) — length check passed (28 chars)
   ```

5. The tool, which has been waiting, returns that report and the agent continues.

The agent never opens the destination: the user runs the write with a command they can read. That also keeps secret-guarding extensions such as [cc-safety-net](https://github.com/kenryu42/cc-safety-net) in charge of the agent's tool calls, since pi's `!` commands are the user's own.

```
╭─ Secret Drop ──────────────────────────────────────────────────────────────╮
│ Staging database password                                                  │
│                                                                            │
│ How to get it                                                              │
│ 1. Open the staging project in 1Password                                   │
│ 2. Copy the password of the "db-staging" item                              │
│                                                                            │
│ Goes to  ./.env (env DB_PASSWORD)                                          │
│ Next     Enter here stages the value. Your prompt then holds a ! command;  │
│          press Enter on it to apply. The agent never sees the value.       │
│                                                                            │
│ › ••••••••••••••••••••••••••••                                             │
│   28 chars                                                                 │
│                                                                            │
│ Enter stage · Tab ask a question instead · Esc cancel · Ctrl+R show/hide · │
│ Ctrl+U clear                                                               │
│ Stuck or unsure? Press Tab and ask; the dialog closes and the agent        │
│ answers.                                                                   │
╰────────────────────────────────────────────────────────────────────────────╯
```

Tab opens a visible question field. Enter there closes the dialog without staging anything, discards what was typed in the secret field, and returns the question to the agent, which answers and calls `secret_drop` again. When the steps do not fit the terminal, the dialog shortens them; the tool call in the chat shows them in full.

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
| `label` | What the user should enter, in the user's language. |
| `instructions` | Required. Numbered steps, in the user's language: where to go (URL or menu path), what to fill in, and what to copy. One step for a value the user already knows. |
| `url` | The page where the user creates or finds the secret. |
| `format` | `env`, `regex`, `file`, or `command`. Defaults to `env` when `key` is set, `command` when `command` is set, else `file`. |
| `destination` | `env` / `regex` / `file`: target file, relative to the working directory. Missing directories are created. |
| `key`, `quote` | `env`: variable name and quoting (`auto`, `none`, `single`, `double`). Existing `KEY=` / `export KEY=` lines are replaced, keeping trailing `# comments` and CRLF endings; otherwise the line is appended. Use `none` for files read by `docker --env-file`, which keeps quotes as part of the value. |
| `regex`, `flags` | `regex`: replaces capture group 1, or the whole match, in an existing file. `g` replaces every match. |
| `fileMode` | Octal permissions. New files default to `600`; existing files keep their mode. |
| `overwrite` | `file`: allow replacing an existing destination, for rotating single-value files such as keys. Without it an existing destination is refused; with it the dialog warns in red. |
| `command` | `command`: shell command reading the staged file `{secret}`, e.g. `ansible-vault encrypt_string --stdin-name db_password < {secret} >> vault.yml`. Stdout is discarded; stderr is shown with the value redacted when the command fails. |

Writes are atomic (temp file + rename) and verified by re-reading the destination. When verification fails, the original content and mode are restored from memory (a newly created file is removed); no backup file is written, so no copy of a secret is left outside the protected destination. The staged file is overwritten and deleted after every apply attempt, and when the tool is cancelled or aborted. Staged files left by pi processes that have exited are removed at session start.

## Protection after the write

- **Blocked reads.** `read`, `edit`, `write`, and `grep` on a destination or the staging area are blocked. In bash, each simple command is checked on its own: it is blocked when a protected path is an argument of a command that prints, copies, or opens files (`cat`, `head`, `grep`, `sed`, `cp`, `base64`, …, also behind `sudo`, `env`, `timeout`, `xargs`), a `<` or `>` redirection target, or inside `sh -c`, `eval`, `$(…)`, or backticks. Commands that only pass the path to a consumer, such as `--env-file .env` or `test -s .env`, still run.
- **Redaction.** Any tool result or context message containing a secret value is rewritten to `[REDACTED]`. Values are reloaded from protected destinations at session start.
- **Registry.** Protected locations (never values) live in `~/.pi/agent/secret-drop/registry.json`. `/secret-drop` lists them; `/secret-drop forget <path>` removes one.

## Limits

- Requires the interactive terminal UI. In RPC, JSON, and print modes the tool fails instead of falling back to a plain-text prompt.
- The dialog is a centered overlay, which pi-tui cannot draw over rows holding terminal images. Set `PI_ASK_USER_DISPLAY_MODE=inline` (the variable pi-ask-user reads) in the shell that launches pi to render it inline instead.
- The bash guard parses command lines, not programs. It stops accidental reads, not a determined agent: an indirect path (a variable, a glob, a script or `python -c` that prints the file) passes through. Redaction is the second layer for that output.
- The rename replaces the destination's inode: hard links to it break and the file becomes owned by the user who runs the apply command. Symlinks are resolved and kept.
- A multi-line quoted `KEY="…` value is replaced on its first line only.
- Values shorter than 4 characters are not redacted. Values applied with `format: "command"` are redacted for the rest of the session only.
- The apply command is shown before it runs; review it, since a `command` can send the staged value anywhere.

## Development

```bash
npm install
npm run check   # tsc --noEmit
npm test        # builds dist/, then node --test
```

`lib/` holds the placement and write logic shared by the extension and the apply script. The extension imports it as TypeScript, so pi's `/reload` picks up an upgrade; Node caches `.js` and `.mjs` modules for the life of the process. `npm run build` compiles `lib/` to `dist/` for the apply script, which runs with plain `node` because Node does not strip TypeScript types under `node_modules`. `npm pack` and `npm publish` build first.

Releases publish from GitHub Actions through npm trusted publishing: bump `version` in `package.json`, commit, and push a matching `v<version>` tag.

## License

MIT
