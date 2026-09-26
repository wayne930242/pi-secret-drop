/**
 * Decide whether a tool call would expose or clobber a protected secret file.
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

/** Commands that print, copy, or open file contents. Scripts that consume a file stay allowed. */
const READERS = new Set([
	"cat", "bat", "less", "more", "most", "head", "tail", "tac", "nl", "pr",
	"grep", "egrep", "fgrep", "rg", "ag", "ack", "sed", "awk", "gawk", "cut", "sort", "uniq", "paste", "column",
	"strings", "xxd", "hexdump", "od", "base64", "base32", "diff", "cmp", "comm",
	"vi", "vim", "nvim", "nano", "emacs", "code", "open", "pbcopy", "xclip", "xsel",
	"cp", "mv", "scp", "rsync", "tee", "dd", "install", "jq", "yq", "dotenv", "envsubst",
]);

const FILE_TOOLS = new Set(["read", "edit", "write", "grep"]);

export function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

/** Absolute path with symlinks resolved when the file exists. */
export function canonicalPath(path: string, cwd: string): string {
	const expanded = expandHome(path.startsWith("@") ? path.slice(1) : path);
	const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

function blockReason(path: string): string {
	return [
		`${path} holds a secret managed by secret_drop; its contents stay out of the conversation.`,
		"Let the program that needs it read the file itself, or ask the user to run the consuming command with `!`.",
		"Call secret_drop again to change the value.",
	].join(" ");
}

function commandTokens(command: string): string[] {
	return command
		.replace(/\$\{?HOME\}?/g, homedir())
		.split(/[\s'"`;&|()<>=,]+/)
		.filter((token) => token.length > 0);
}

/**
 * Return a block reason when the call touches a protected path, otherwise undefined.
 * `isProtected` receives canonical absolute paths.
 */
export function checkToolCall(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
	isProtected: (canonical: string) => boolean,
): string | undefined {

	if (FILE_TOOLS.has(toolName)) {
		const path = input.path;
		if (typeof path !== "string" || path.length === 0) return undefined;
		const target = canonicalPath(path, cwd);
		return isProtected(target) ? blockReason(path) : undefined;
	}

	if (toolName === "bash") {
		const command = input.command;
		if (typeof command !== "string") return undefined;
		const tokens = commandTokens(command);
		const hit = tokens.find((token) => isProtected(canonicalPath(token, cwd)));
		if (!hit) return undefined;
		const readsIt = tokens.some((token) => READERS.has(basename(token))) || /(?<![<\d])<(?![<&(])/.test(command);
		return readsIt ? blockReason(hit) : undefined;
	}

	return undefined;
}
