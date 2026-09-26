// @ts-check
/**
 * Atomic file write for a placed secret.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { applyPlacement } from "./placement.mjs";

/** @typedef {import("./placement.mjs").Placement} Placement */
/** @typedef {{ bytes: number, created: boolean, mode: number, summary: string }} WriteOutcome */

export const DEFAULT_NEW_FILE_MODE = 0o600;

/**
 * @param {string} path
 * @returns {Promise<string | undefined>}
 */
export async function readExisting(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return undefined;
		throw error;
	}
}

/**
 * Place `value` into `path` and write it atomically.
 * New files get `fileMode ?? 0600`; existing files keep their mode unless `fileMode` is given.
 * @param {string} path
 * @param {Placement} placement
 * @param {string} value
 * @param {number | undefined} fileMode
 * @returns {Promise<WriteOutcome>}
 */
export async function writeSecret(path, placement, value, fileMode) {
	const existing = await readExisting(path);
	const { content, summary } = applyPlacement(existing, placement, value);
	const created = existing === undefined;
	const mode = fileMode ?? (created ? DEFAULT_NEW_FILE_MODE : (await stat(path)).mode & 0o777);

	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		await writeFile(tmp, content, { mode: 0o600, flag: "wx" });
		await chmod(tmp, mode);
		await rename(tmp, path);
	} catch (error) {
		await unlink(tmp).catch(() => undefined);
		throw error;
	}
	return { bytes: Buffer.byteLength(content), created, mode, summary };
}

/**
 * Parse an octal permission string such as "600".
 * @param {string | undefined} raw
 * @returns {number | undefined}
 */
export function parseFileMode(raw) {
	if (raw === undefined) return undefined;
	if (!/^0?[0-7]{3}$/.test(raw)) throw new Error(`Invalid file mode "${raw}". Use octal like "600".`);
	return Number.parseInt(raw, 8);
}
