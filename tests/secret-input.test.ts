import assert from "node:assert/strict";
import { test } from "node:test";
import { dialogOptions } from "../src/secret-input.ts";

test("PI_ASK_USER_DISPLAY_MODE=inline renders the dialog inline", () => {
	assert.deepEqual(dialogOptions({ PI_ASK_USER_DISPLAY_MODE: "inline" }), { overlay: false });
});

test("the dialog is a centered overlay by default and for other values", () => {
	for (const env of [{}, { PI_ASK_USER_DISPLAY_MODE: "overlay" }, { PI_ASK_USER_DISPLAY_MODE: "Inline" }]) {
		const options = dialogOptions(env);
		assert.equal(options.overlay, true, JSON.stringify(env));
		assert.equal(options.overlayOptions?.anchor, "center");
	}
});
