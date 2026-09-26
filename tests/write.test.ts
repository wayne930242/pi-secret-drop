import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Registry } from "../src/registry.ts";
import { writeSecret } from "../lib/write.mjs";

const dir = mkdtempSync(join(tmpdir(), "secret-drop-write-"));

test("new file is created with 0600 in a new directory", async () => {
	const path = join(dir, "nested", "key.pem");
	const outcome = await writeSecret(path, { mode: "file" }, "PEMDATA", undefined);
	assert.equal(readFileSync(path, "utf8"), "PEMDATA");
	assert.equal(statSync(path).mode & 0o777, 0o600);
	assert.equal(outcome.created, true);
});

test("existing file keeps its mode unless fileMode is given, and leaves no temp files", async () => {
	const path = join(dir, ".env");
	writeFileSync(path, "A=1\n", { mode: 0o644 });
	await writeSecret(path, { mode: "env", key: "TOKEN", quote: "auto" }, "abc", undefined);
	assert.equal(readFileSync(path, "utf8"), "A=1\nTOKEN=abc\n");
	assert.equal(statSync(path).mode & 0o777, 0o644);
	await writeSecret(path, { mode: "env", key: "TOKEN", quote: "auto" }, "def", 0o600);
	assert.equal(readFileSync(path, "utf8"), "A=1\nTOKEN=def\n");
	assert.equal(statSync(path).mode & 0o777, 0o600);
	assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
});

test("registry stores locations, not values, and dedupes by slot", async () => {
	const file = join(dir, "registry.json");
	const registry = new Registry(file);
	await registry.load();
	const base = { path: "/x/.env", label: "l", updatedAt: "t" };
	await registry.upsert({ ...base, placement: { mode: "env", key: "A", quote: "auto" } });
	await registry.upsert({ ...base, placement: { mode: "env", key: "A", quote: "auto" } });
	await registry.upsert({ ...base, placement: { mode: "env", key: "B", quote: "auto" } });
	const reloaded = new Registry(file);
	await reloaded.load();
	assert.equal(reloaded.list().length, 2);
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.equal(await reloaded.forget("/x/.env"), 2);
});
