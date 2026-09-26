// @ts-check
/**
 * Pure placement logic: where a secret goes inside a file, and how to find it again.
 * Plain JavaScript so the apply CLI runs from node_modules without type stripping.
 */

/** @typedef {"auto" | "none" | "single" | "double"} EnvQuote */
/**
 * @typedef {{ mode: "file" }
 *   | { mode: "env", key: string, quote: EnvQuote }
 *   | { mode: "regex", pattern: string, flags: string }} Placement
 */
/** @typedef {{ content: string, summary: string }} PlacementResult */

export const ENV_QUOTES = /** @type {const} */ (["auto", "none", "single", "double"]);

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SAFE_UNQUOTED = /^[A-Za-z0-9_\-.,/:@%+=]*$/;

/** @param {string} text */
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string} key */
function envLinePattern(key) {
	return new RegExp(`^([ \\t]*(?:export[ \\t]+)?${escapeRegExp(key)}[ \\t]*=)(.*)$`, "gm");
}

/**
 * Compile the placement regex with match indices so the first capture group can be replaced.
 * @param {string} pattern
 * @param {string} flags
 */
function compileRegex(pattern, flags) {
	const cleaned = [...new Set(flags.replace(/d/g, ""))].join("");
	return new RegExp(pattern, `${cleaned}d`);
}

/**
 * Throw when the env key or regex is malformed. Needs no file.
 * @param {Placement} placement
 */
export function validateSyntax(placement) {
	if (placement.mode === "env" && !ENV_KEY.test(placement.key)) {
		throw new Error(`Invalid env key "${placement.key}". Use letters, digits, "_" or ".", not starting with a digit.`);
	}
	if (placement.mode === "regex") {
		try {
			compileRegex(placement.pattern, placement.flags);
		} catch (error) {
			throw new Error(`Invalid regex: ${/** @type {Error} */ (error).message}`);
		}
	}
}

/**
 * Return a message when a file placement would replace an existing file without `overwrite`.
 * @param {Placement} placement
 * @param {boolean} exists
 * @param {boolean} overwrite
 * @returns {string | undefined}
 */
export function checkOverwrite(placement, exists, overwrite) {
	if (placement.mode !== "file" || !exists || overwrite) return undefined;
	return "The destination exists and file placement would replace all of it. Use env or regex to change one value; pass overwrite only for single-value files such as keys or password files.";
}

/**
 * Throw when the placement cannot be applied to `existing` (undefined for a missing file).
 * @param {Placement} placement
 * @param {string | undefined} existing
 * @param {boolean} [overwrite]
 */
export function validatePlacement(placement, existing, overwrite = false) {
	validateSyntax(placement);
	const refused = checkOverwrite(placement, existing !== undefined, overwrite);
	if (refused) throw new Error(refused);
	if (placement.mode !== "regex") return;
	if (existing === undefined) throw new Error("regex placement needs an existing file to locate the insertion point.");
	if (!compileRegex(placement.pattern, placement.flags).test(existing)) {
		throw new Error(`Pattern /${placement.pattern}/${placement.flags} does not match the destination file.`);
	}
}

/**
 * @param {EnvQuote} quote
 * @param {string} value
 * @returns {Exclude<EnvQuote, "auto">}
 */
function resolveQuote(quote, value) {
	if (quote !== "auto") return quote;
	if (SAFE_UNQUOTED.test(value)) return "none";
	return value.includes("'") ? "double" : "single";
}

/**
 * Return a message when the placement cannot represent `value`, otherwise undefined.
 * @param {Placement} placement
 * @param {string} value
 * @returns {string | undefined}
 */
export function checkValue(placement, value) {
	if (value.length === 0) return "Value is empty.";
	if (placement.mode !== "file" && /[\r\n]/.test(value)) return `${placement.mode} placement needs a single-line value.`;
	if (placement.mode === "env") {
		const q = resolveQuote(placement.quote, value);
		if (q === "none" && !SAFE_UNQUOTED.test(value)) return "Value needs quoting; use quote auto, single, or double.";
		if (q === "single" && value.includes("'")) return "Value contains a single quote; use quote auto or double.";
	}
	return undefined;
}

/**
 * @param {string} value
 * @param {EnvQuote} quote
 */
export function encodeEnvValue(value, quote) {
	switch (resolveQuote(quote, value)) {
		case "none":
			return value;
		case "single":
			return `'${value}'`;
		case "double":
			return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
	}
}

/**
 * Split the text after `KEY=` into the value and a trailing ` # comment` outside quotes.
 * The comment keeps its leading whitespace; an unterminated quote yields no comment.
 * @param {string} raw
 * @returns {{ value: string, comment: string }}
 */
export function splitEnvComment(raw) {
	const start = raw.length - raw.trimStart().length;
	const quote = raw[start];
	if (quote === "'" || quote === '"') {
		let end = start + 1;
		while (end < raw.length && raw[end] !== quote) end += quote === '"' && raw[end] === "\\" ? 2 : 1;
		const rest = raw.slice(end + 1);
		if (end < raw.length && /^\s*#/.test(rest)) return { value: raw.slice(0, end + 1), comment: rest };
		return { value: raw, comment: "" };
	}
	const hash = raw.search(/\s#/);
	return hash === -1 ? { value: raw, comment: "" } : { value: raw.slice(0, hash), comment: raw.slice(hash) };
}

/** @param {string} raw */
export function decodeEnvValue(raw) {
	const trimmed = splitEnvComment(raw).value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\([\\"$`])/g, "$1");
	}
	return trimmed;
}

/**
 * Produce the new file content with the secret placed. `existing` is undefined for a new file.
 * @param {string | undefined} existing
 * @param {Placement} placement
 * @param {string} value
 * @returns {PlacementResult}
 */
export function applyPlacement(existing, placement, value) {
	switch (placement.mode) {
		case "file":
			return { content: value, summary: existing === undefined ? "created file" : "replaced file content" };
		case "env": {
			const encoded = encodeEnvValue(value, placement.quote);
			const base = existing ?? "";
			const re = envLinePattern(placement.key);
			if (re.test(base)) {
				re.lastIndex = 0;
				let count = 0;
				const content = base.replace(re, (_match, /** @type {string} */ prefix, /** @type {string} */ old) => {
					count += 1;
					const { comment } = splitEnvComment(old.replace(/\r$/, ""));
					return `${prefix}${encoded}${comment}${old.endsWith("\r") ? "\r" : ""}`;
				});
				return { content, summary: `updated ${placement.key} (${count} line${count === 1 ? "" : "s"})` };
			}
			const separator = base.length === 0 || base.endsWith("\n") ? "" : "\n";
			return { content: `${base}${separator}${placement.key}=${encoded}\n`, summary: `appended ${placement.key}` };
		}
		case "regex": {
			if (existing === undefined) throw new Error("regex placement needs an existing file.");
			const re = compileRegex(placement.pattern, placement.flags);
			let content = "";
			let cursor = 0;
			let count = 0;
			re.lastIndex = 0;
			/** @type {RegExpExecArray | null} */
			let match;
			while ((match = re.exec(existing)) !== null) {
				const span = match.indices?.[1] ?? match.indices?.[0];
				if (!span) break;
				content += existing.slice(cursor, span[0]) + value;
				cursor = span[1];
				count += 1;
				if (!re.global) break;
				if (match[0].length === 0) re.lastIndex += 1;
			}
			if (count === 0) throw new Error(`Pattern /${placement.pattern}/${placement.flags} does not match the destination file.`);
			content += existing.slice(cursor);
			return { content, summary: `replaced ${count} regex match${count === 1 ? "" : "es"}` };
		}
	}
}

/**
 * Check that `content` holds `value` at the placement. Used after a write.
 * @param {string} content
 * @param {Placement} placement
 * @param {string} value
 */
export function verifyPlaced(content, placement, value) {
	if (placement.mode === "file") return content === value;
	if (placement.mode === "env") return extractSecret(content, placement) === value;
	return content.includes(value);
}

/**
 * Recover the stored secret from file content, for redaction after a restart.
 * @param {string} content
 * @param {Placement} placement
 * @returns {string | undefined}
 */
export function extractSecret(content, placement) {
	switch (placement.mode) {
		case "file":
			return content.length > 0 ? content : undefined;
		case "env": {
			/** @type {string | undefined} */
			let last;
			for (const match of content.matchAll(envLinePattern(placement.key))) last = decodeEnvValue(match[2] ?? "");
			return last ? last : undefined;
		}
		case "regex": {
			/** @type {RegExp} */
			let re;
			try {
				re = compileRegex(placement.pattern, placement.flags);
			} catch {
				return undefined;
			}
			const match = re.exec(content);
			if (!match) return undefined;
			const value = match[1] ?? match[0];
			return value.length > 0 ? value : undefined;
		}
	}
}

/** @param {Placement} placement */
export function describePlacement(placement) {
	switch (placement.mode) {
		case "file":
			return "whole file";
		case "env":
			return `env ${placement.key}`;
		case "regex":
			return `regex /${placement.pattern}/${placement.flags}`;
	}
}
