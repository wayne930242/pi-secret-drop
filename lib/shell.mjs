// @ts-check
/**
 * POSIX shell quoting for the commands shown to and run by the user.
 */

const SAFE = /^[A-Za-z0-9_\-.,/:@%+=]+$/;

/** @param {string} word */
export function shellQuote(word) {
	return SAFE.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}
