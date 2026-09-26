/**
 * Masked secret entry dialog. Keeps the value in this component only and hands it to `done`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	decodeKittyPrintable,
	type Focusable,
	getKeybindings,
	isKeyRelease,
	matchesKey,
	type OverlayOptions,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const MASK = "•";

export interface SecretPrompt {
	title: string;
	label: string;
	/** Labelled facts shown under the label, e.g. the destination and the apply command. */
	rows: ReadonlyArray<readonly [string, string]>;
	/** Shown in the error color under the rows, e.g. an overwrite notice. */
	warning?: string;
	footer: string;
	/** Return an error message to keep the dialog open, or undefined to accept. */
	check: (value: string) => string | undefined;
}

/**
 * `ctx.ui.custom` options for the dialog. Pi-TUI overlays cannot draw over rows holding terminal
 * images, so `PI_ASK_USER_DISPLAY_MODE=inline` (shared with pi-ask-user) renders it inline instead.
 */
export function dialogOptions(env: NodeJS.ProcessEnv = process.env): { overlay: boolean; overlayOptions?: OverlayOptions } {
	if (env.PI_ASK_USER_DISPLAY_MODE === "inline") return { overlay: false };
	return { overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 50, maxHeight: "85%", margin: 1 } };
}

function isPrintable(data: string): boolean {
	return [...data].every((ch) => {
		const code = ch.charCodeAt(0);
		return !(code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f));
	});
}

export class SecretInput implements Component, Focusable {
	focused = false;
	private value = "";
	private reveal = false;
	private error: string | undefined;
	private inPaste = false;
	private pasteBuffer = "";
	private closed = false;

	private readonly prompt: SecretPrompt;
	private readonly theme: Theme;
	private readonly requestRender: () => void;
	private readonly done: (value: string | null) => void;

	constructor(prompt: SecretPrompt, theme: Theme, requestRender: () => void, done: (value: string | null) => void) {
		this.prompt = prompt;
		this.theme = theme;
		this.requestRender = requestRender;
		this.done = done;
	}

	/** Close the dialog without a value, for example when the tool call is aborted. */
	cancel(): void {
		this.finish(null);
	}

	private finish(value: string | null): void {
		if (this.closed) return;
		this.closed = true;
		this.done(value);
		this.value = "";
		this.pasteBuffer = "";
	}

	private append(text: string): void {
		this.value += text;
		this.error = undefined;
	}

	handleInput(data: string): void {
		if (this.closed) return;
		if (data.includes(PASTE_START)) {
			this.inPaste = true;
			this.pasteBuffer = "";
			data = data.replace(PASTE_START, "");
		}
		if (this.inPaste) {
			this.pasteBuffer += data;
			const end = this.pasteBuffer.indexOf(PASTE_END);
			if (end === -1) return;
			this.append(this.pasteBuffer.slice(0, end).replace(/\r\n?/g, "\n"));
			const rest = this.pasteBuffer.slice(end + PASTE_END.length);
			this.inPaste = false;
			this.pasteBuffer = "";
			if (rest) this.handleInput(rest);
			this.requestRender();
			return;
		}
		if (isKeyRelease(data)) return;

		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel")) {
			this.finish(null);
			return;
		}
		if (kb.matches(data, "tui.input.submit") || data === "\n") {
			const error = this.prompt.check(this.value);
			if (error) {
				this.error = error;
				this.requestRender();
				return;
			}
			this.finish(this.value);
			return;
		}
		if (matchesKey(data, "ctrl+r")) {
			this.reveal = !this.reveal;
		} else if (kb.matches(data, "tui.editor.deleteToLineStart")) {
			this.value = "";
		} else if (kb.matches(data, "tui.editor.deleteCharBackward")) {
			this.value = [...this.value].slice(0, -1).join("");
		} else {
			const printable = decodeKittyPrintable(data) ?? (isPrintable(data) ? data : undefined);
			if (printable === undefined) return;
			this.append(printable);
		}
		this.requestRender();
	}

	invalidate(): void {}

	private field(width: number): string {
		const t = this.theme;
		if (this.value.length === 0) return t.fg("dim", "type or paste the secret");
		if (this.reveal) return truncateToWidth(t.fg("warning", this.value.replace(/\n/g, "⏎")), width, "…");
		const count = [...this.value].length;
		return t.fg("accent", MASK.repeat(Math.min(count, Math.max(1, width - 1)))) + (count > width - 1 ? "…" : "");
	}

	render(width: number): string[] {
		const t = this.theme;
		const inner = Math.max(10, width - 4);
		const body: string[] = [];
		const wrap = (text: string) => body.push(...wrapTextWithAnsi(text, inner));

		wrap(t.bold(t.fg("text", this.prompt.label)));
		body.push("");
		const pad = Math.max(...this.prompt.rows.map(([name]) => name.length)) + 2;
		for (const [name, value] of this.prompt.rows) wrap(`${t.fg("muted", name.padEnd(pad))}${t.fg("text", value)}`);
		if (this.prompt.warning) wrap(t.bold(t.fg("error", `⚠ ${this.prompt.warning}`)));
		body.push("");
		body.push(`${t.fg("accent", "› ")}${this.field(inner - 2)}`);
		const chars = [...this.value].length;
		const lines = this.value.length === 0 ? 0 : this.value.split("\n").length;
		body.push(t.fg("dim", `${chars} char${chars === 1 ? "" : "s"}${lines > 1 ? `, ${lines} lines` : ""}`));
		if (this.error) wrap(t.fg("error", this.error));
		body.push("");
		wrap(t.fg("dim", "Enter stage · Esc cancel · Ctrl+R show/hide · Ctrl+U clear"));
		wrap(t.fg("dim", this.prompt.footer));

		const border = (s: string) => t.fg("borderAccent", s);
		const title = ` ${this.prompt.title} `;
		const top = border(`╭─${title}${"─".repeat(Math.max(0, inner - visibleWidth(title)))}─╮`);
		const bottom = border(`╰${"─".repeat(inner + 2)}╯`);
		const rows = body.map((line) => {
			const fitted = truncateToWidth(line, inner, "…");
			return `${border("│")} ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} ${border("│")}`;
		});
		return [top, ...rows, bottom];
	}
}
