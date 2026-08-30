/**
 * What to put on a file input's `accept` attribute right now.
 *
 * Android's Storage Access Framework and the iOS document browser both resolve
 * an `accept` list against the operating system's type database rather than
 * against the filename. Neither ships a type for `.tsx`, `.jsx`, `.mjs` or
 * `.cjs`, and Android maps `.ts` to `video/mp2t` - so a filter that reads
 * perfectly on desktop greys out every source file on a phone and the user is
 * left with a picker that will not let them select anything at all.
 *
 * The fix is to keep the desktop filter, which is also what the server renders,
 * and drop it after hydration on the platforms that cannot use it. The bytes
 * are validated after the pick either way, so nothing is lost by asking for
 * everything there.
 */

/**
 * True where an `accept` list is more likely to hide the user's file than to
 * help them find it - phones and tablets. Safe to call during SSR, where it is
 * false; call it from an effect so the attribute is only relaxed after
 * hydration and the server and client markup still match.
 */
export function isRestrictiveFilePicker(): boolean {
	if (typeof navigator === 'undefined') return false
	const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
	if (data?.mobile === true) return true
	const ua = navigator.userAgent || ''
	if (/Android|iPhone|iPod|Windows Phone/i.test(ua)) return true
	// iPadOS reports itself as a Mac; the touch points give it away.
	if (/iPad/i.test(ua)) return true
	return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
}

/** The `accept` value for `list`, or `undefined` where a filter would hide everything. */
export function pickerAccept(list: string): string | undefined {
	return isRestrictiveFilePicker() ? undefined : list
}
