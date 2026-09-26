---
name: secret-drop
description: Use when a password, token, API key, certificate, or other credential must be written to a file or fed to a command, or when working with a file that holds one.
---

# Secret Drop

Secrets reach files and commands through the `secret_drop` tool, so the value never enters the conversation. The user types it into a masked dialog; it is staged outside the project; pi pre-fills a `!` apply command in the user's prompt; the user runs it. The tool waits for that run and returns the apply script's report: what changed and a length check. Files that hold secrets are opaque to the agent: programs consume them, the agent never reads them.

## Writing a secret

1. Pick the destination the consuming program expects. For a `regex` placement in a file that is not yet protected, read its structure first.
2. Call `secret_drop` with a `label` naming exactly what to enter (service, account, environment) and one format:
   - `key` + `destination` (format `env`): sets `KEY=value`, replacing existing `KEY` / `export KEY` lines or appending one.
   - `format: "regex"` + `destination` + `regex`: replaces capture group 1, or the whole match, in an existing file. Make the group cover only the value, e.g. `password: "([^"]*)"`.
   - `format: "file"` + `destination`: the whole file is the secret, for key files and single-value files.
   - `command` (format `command`): a shell command that reads the staged file `{secret}`. Redirect results into files; stdout is discarded. Examples:
     - `ansible-vault encrypt_string --vault-password-file .vault-pass --stdin-name db_password < {secret} >> group_vars/prod/vault.yml`
     - `gh secret set DEPLOY_TOKEN < {secret}`
     - `kubectl create secret generic app-tls --from-file=tls.key={secret}`
3. Call it once per secret and wait for the result:
   - **Applied**: the report states the change and `length check passed (N chars)`. That report is the verification; the value is in place.
   - **Cancelled or aborted**: nothing was applied. Ask the user how to proceed.
   - **Apply failed**: the staged value was discarded. Fix the parameters from the error (a regex that does not match, a failing command) and call again.

When the user offers to paste a secret into chat, call `secret_drop` instead.

## Using a file that holds a secret

Let the program that needs the secret read the file itself: a script that loads `.env` internally, a `--env-file` or `--vault-password-file` flag, or a config path. Once `secret_drop` applies a secret, `read`, `edit`, `write`, `grep`, and bash commands that print or copy the destination are blocked, and tool output containing the value shows `[REDACTED]`. Other safety extensions block secret files such as `.env` too. When a consuming command is blocked, ask the user to run it with `!`, and continue from its output.

To change a value, call `secret_drop` again with the same destination and placement. When non-secret lines in a protected file need edits, ask the user to make them.
