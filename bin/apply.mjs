#!/usr/bin/env node
// @ts-check
/**
 * Apply a staged secret to its destination. The user runs this through a pi `!` command, so its
 * output reaches the model: it reports what changed and a length check, never the value.
 */

import { spawn } from "node:child_process";
import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { checkValue, describePlacement, ENV_QUOTES, validatePlacement, verifyPlaced } from "../lib/placement.mjs";
import { shellQuote } from "../lib/shell.mjs";
import { parseFileMode, readExisting, writeSecret } from "../lib/write.mjs";

/** @typedef {import("../lib/placement.mjs").Placement} Placement */
/** @typedef {{ quote?: string, flags?: string, mode?: string }} Options */

const USAGE = `usage:
  apply.mjs env <destination> <KEY> --from <staged> [--quote auto|none|single|double] [--mode 600]
  apply.mjs regex <destination> <regex> --from <staged> [--flags g] [--mode 600]
  apply.mjs file <destination> --from <staged> [--mode 600]
  apply.mjs exec <command using {secret}> --from <staged>`;

/**
 * Overwrite then delete the staged file.
 * @param {string} path
 */
async function wipe(path) {
	try {
		const { size } = await stat(path);
		const handle = await open(path, "r+");
		try {
			await handle.write(Buffer.alloc(size), 0, size, 0);
		} finally {
			await handle.close();
		}
	} catch {
		// Missing or unwritable: removal below still runs.
	}
	await rm(path, { force: true });
}

/**
 * @param {string} value
 * @param {string} text
 */
function redact(value, text) {
	return value.length > 0 ? text.split(value).join("[REDACTED]") : text;
}

/** @param {string} value */
function chars(value) {
	return [...value].length;
}

/**
 * Run a shell command with {secret} replaced by the staged file path. Stdout is discarded.
 * @param {string} command
 * @param {string} staged
 * @param {string} value
 */
async function runCommand(command, staged, value) {
	if (!command.includes("{secret}")) throw new Error("exec command must reference {secret}.");
	const script = command.split("{secret}").join(shellQuote(staged));
	const child = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
	let stdoutBytes = 0;
	let stderr = "";
	child.stdout.on("data", (/** @type {Buffer} */ chunk) => {
		stdoutBytes += chunk.length;
	});
	child.stderr.on("data", (/** @type {Buffer} */ chunk) => {
		stderr += chunk.toString("utf8");
	});
	/** @type {number | null} */
	const code = await new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", resolve);
	});
	if (code !== 0) {
		const tail = redact(value, stderr).trim().split("\n").slice(-15).join("\n");
		throw new Error(`command exited ${code}${tail ? `:\n${tail}` : ""}`);
	}
	const suppressed = stdoutBytes > 0 ? `; ${stdoutBytes} bytes of stdout suppressed` : "";
	return `command exited 0 — secret delivered via {secret} (${chars(value)} chars)${suppressed}`;
}

/**
 * @param {string | undefined} format
 * @param {string[]} args
 * @param {Options} options
 * @param {string} staged
 * @param {string} value
 */
async function apply(format, args, options, staged, value) {
	if (format === "exec") {
		if (args.length !== 1 || !args[0]) throw new Error(USAGE);
		return runCommand(args[0], staged, value);
	}

	/** @type {Placement} */
	let placement;
	const destination = args[0];
	if (format === "env" && args.length === 2 && destination && args[1]) {
		const quote = options.quote ?? "auto";
		const known = /** @type {readonly string[]} */ (ENV_QUOTES);
		if (!known.includes(quote)) throw new Error(`Invalid quote "${quote}".`);
		placement = { mode: "env", key: args[1], quote: /** @type {import("../lib/placement.mjs").EnvQuote} */ (quote) };
	} else if (format === "regex" && args.length === 2 && destination && args[1]) {
		placement = { mode: "regex", pattern: args[1], flags: options.flags ?? "" };
	} else if (format === "file" && args.length === 1 && destination) {
		placement = { mode: "file" };
	} else {
		throw new Error(USAGE);
	}

	const fileMode = parseFileMode(options.mode);
	const problem = checkValue(placement, value);
	if (problem) throw new Error(problem);
	validatePlacement(placement, await readExisting(destination));
	const outcome = await writeSecret(destination, placement, value, fileMode);
	if (!verifyPlaced(await readFile(destination, "utf8"), placement, value)) {
		throw new Error(`length check failed: ${destination} does not hold the ${chars(value)}-char value at ${describePlacement(placement)}.`);
	}
	const where = `${destination} (${describePlacement(placement)}, mode ${outcome.mode.toString(8)})`;
	return `${outcome.summary} in ${where} — length check passed (${chars(value)} chars)`;
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			from: { type: "string" },
			quote: { type: "string" },
			flags: { type: "string" },
			mode: { type: "string" },
		},
	});
	const staged = values.from;
	if (!staged) {
		console.error(USAGE);
		process.exitCode = 2;
		return;
	}
	const [format, ...args] = positionals;
	const resultFile = `${staged}.result`;
	let value = "";
	try {
		try {
			value = await readFile(staged, "utf8");
		} catch {
			throw new Error("staged secret not found; it was already applied or discarded. Call secret_drop again.");
		}
		const message = await apply(format, args, values, staged, value);
		await writeFile(resultFile, JSON.stringify({ ok: true, message }), { mode: 0o600 });
		console.log(`✓ secret-drop: ${message}`);
	} catch (error) {
		const message = redact(value, /** @type {Error} */ (error).message);
		await writeFile(resultFile, JSON.stringify({ ok: false, message }), { mode: 0o600 }).catch(() => undefined);
		console.error(`✗ secret-drop: ${message}`);
		process.exitCode = 1;
	} finally {
		await wipe(staged);
	}
}

await main();
