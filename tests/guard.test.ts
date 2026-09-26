import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalPath, checkToolCall } from "../src/guard.ts";

const dir = mkdtempSync(join(tmpdir(), "secret-drop-guard-"));
writeFileSync(join(dir, ".env"), "K=v\n");
const secret = canonicalPath(".env", dir);
const isProtected = (path: string) => path === secret;

test("file tools on a protected path are blocked", () => {
	for (const tool of ["read", "edit", "write", "grep"]) {
		assert.ok(checkToolCall(tool, { path: ".env" }, dir, isProtected), tool);
		assert.ok(checkToolCall(tool, { path: secret }, "/", isProtected), tool);
	}
	assert.equal(checkToolCall("read", { path: "other.txt" }, dir, isProtected), undefined);
});

test("bash commands that print the file are blocked; consumers are allowed", () => {
	for (const command of ["cat .env", "grep K .env", `head -1 ${secret}`, "base64 < .env", "cp .env /tmp/x", "echo $(cat ./.env)"]) {
		assert.ok(checkToolCall("bash", { command }, dir, isProtected), command);
	}
	for (const command of ["set -a; . ./.env; set +a; ./deploy.sh", "docker run --env-file .env img", "ls -la", "cat README.md", "ansible-playbook x.yml 2>&1"]) {
		assert.equal(checkToolCall("bash", { command }, dir, isProtected), undefined, command);
	}
});

test("nothing is blocked when no path is protected", () => {
	assert.equal(checkToolCall("read", { path: ".env" }, dir, () => false), undefined);
});
