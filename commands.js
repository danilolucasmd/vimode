// Shared by the background worker (which parses the config) and the content
// script (which runs the commands): the command names and the config parser.
// There is no built-in keymap: the config file is the whole of it, so a key
// does something only if a `map` line says so. Loaded as a classic script in
// both, so it only defines globals.

// Every command, where it runs ("page" in the frame the key was pressed in,
// "tab" in the background worker, which owns the tabs API, "hints" in the
// background worker's hint coordinator) and the line the command line's
// completion shows for it, and the heading it is listed under on the help
// screen. The link hint commands keep Vimium's names.
const VIMODE_COMMANDS = {
	scrollDown: { where: "page", desc: "Scroll down one step", group: "Scrolling" },
	scrollUp: { where: "page", desc: "Scroll up one step", group: "Scrolling" },
	scrollLeft: { where: "page", desc: "Scroll left one step", group: "Scrolling" },
	scrollRight: { where: "page", desc: "Scroll right one step", group: "Scrolling" },
	scrollPageDown: { where: "page", desc: "Scroll down half a page", group: "Scrolling" },
	scrollPageUp: { where: "page", desc: "Scroll up half a page", group: "Scrolling" },
	scrollFullPageDown: { where: "page", desc: "Scroll down a full page", group: "Scrolling" },
	scrollFullPageUp: { where: "page", desc: "Scroll up a full page", group: "Scrolling" },
	scrollToTop: { where: "page", desc: "Scroll to the top of the page", group: "Scrolling" },
	scrollToBottom: { where: "page", desc: "Scroll to the bottom of the page", group: "Scrolling" },
	scrollToLeft: { where: "page", desc: "Scroll all the way left", group: "Scrolling" },
	scrollToRight: { where: "page", desc: "Scroll all the way right", group: "Scrolling" },
	goBack: { where: "page", desc: "Go back in history", group: "Navigation" },
	goForward: { where: "page", desc: "Go forward in history", group: "Navigation" },
	goUp: { where: "page", desc: "Go up one level in the URL path", group: "Navigation" },
	goToRoot: { where: "page", desc: "Go to the site's root", group: "Navigation" },
	reload: { where: "page", desc: "Reload the page", group: "Navigation" },
	copyCurrentUrl: { where: "page", desc: "Copy the page's URL", group: "Navigation" },
	enterInsertMode: { where: "page", desc: "Enter insert mode: keys go to the page until Escape", group: "Modes" },
	enterCommandMode: { where: "page", desc: "Open the command line", group: "Modes" },
	showHelp: { where: "page", desc: "Show every mapped key, grouped", group: "Modes" },
	focusInput: { where: "page", desc: "Focus the first text field on the page", group: "Modes" },
	enterFindMode: { where: "page", desc: "Search the page for text, highlighting every match", group: "Find" },
	performFind: { where: "page", desc: "Go to the next match of the last search", group: "Find" },
	performBackwardsFind: { where: "page", desc: "Go to the previous match of the last search", group: "Find" },
	importConfig: { where: "page", desc: "Import the config: pick vimoderc, style.css, or both", group: "Vimode" },
	reloadExtension: { where: "tab", desc: "Reload Vimode from its directory, and this tab with it", group: "Vimode" },
	nextTab: { where: "tab", desc: "Go to the next tab", group: "Tabs" },
	previousTab: { where: "tab", desc: "Go to the previous tab", group: "Tabs" },
	firstTab: { where: "tab", desc: "Go to the first tab", group: "Tabs" },
	lastTab: { where: "tab", desc: "Go to the last tab", group: "Tabs" },
	visitPreviousTab: { where: "tab", desc: "Go back to the last tab you were on", group: "Tabs" },
	createTab: { where: "tab", desc: "Open a new tab", group: "Tabs" },
	duplicateTab: { where: "tab", desc: "Duplicate this tab", group: "Tabs" },
	removeTab: { where: "tab", desc: "Close this tab", group: "Tabs" },
	restoreTab: { where: "tab", desc: "Reopen the last closed tab", group: "Tabs" },
	togglePinTab: { where: "tab", desc: "Pin or unpin this tab", group: "Tabs" },
	closeOtherTabs: { where: "tab", desc: "Close every other tab except pinned ones", group: "Tabs" },
	closeTabsOnLeft: { where: "tab", desc: "Close the tabs to the left, except pinned ones", group: "Tabs" },
	closeTabsOnRight: { where: "tab", desc: "Close the tabs to the right, except pinned ones", group: "Tabs" },
	moveTabLeft: { where: "tab", desc: "Move this tab one place left", group: "Tabs" },
	moveTabRight: { where: "tab", desc: "Move this tab one place right", group: "Tabs" },
	"LinkHints.activateMode": { where: "hints", desc: "Hint links and click the one picked", group: "Link hints" },
	"LinkHints.activateModeToOpenInNewTab": { where: "hints", desc: "Hint links and open the one picked in a background tab", group: "Link hints" },
	"LinkHints.activateModeToOpenInNewForegroundTab": { where: "hints", desc: "Hint links and open the one picked in a new tab", group: "Link hints" },
	"LinkHints.activateModeWithQueue": { where: "hints", desc: "Hint links and open each one picked in a background tab, until Escape", group: "Link hints" },
	"LinkHints.activateModeToCopyLinkUrl": { where: "hints", desc: "Hint links and copy the address of the one picked", group: "Link hints" },
	"LinkHints.activateModeToDownloadLink": { where: "hints", desc: "Hint links and download the one picked", group: "Link hints" },
};

// What each hint command does with the element picked.
const VIMODE_HINT_MODES = {
	"LinkHints.activateMode": "click",
	"LinkHints.activateModeToOpenInNewTab": "newTab",
	"LinkHints.activateModeToOpenInNewForegroundTab": "newForegroundTab",
	"LinkHints.activateModeWithQueue": "queue",
	"LinkHints.activateModeToCopyLinkUrl": "copy",
	"LinkHints.activateModeToDownloadLink": "download",
};

const VIMODE_DEFAULT_SETTINGS = {
	scrollStepSize: 60,
	grabBackFocus: false,
	// Whether a printable key the keymap does not map reaches the page in
	// normal mode, as in Vimium. Off, it is dropped, like qutebrowser's
	// input.forward_unbound_keys = auto: keys with Ctrl, Alt or Meta and named
	// keys (arrows, space, Enter) still pass. Off is what keeps Google Docs in
	// normal mode, since it refocuses its editor on any character typed.
	passUnmappedKeys: true,
	// The characters link hints are made of, as in Vimium. Shown in capitals.
	linkHintCharacters: "sadfjklewcmpgh",
	// How long a half-typed key sequence waits before the panel listing its
	// continuations appears, in ms, as qutebrowser's keyhint.delay. Negative
	// turns the panel off.
	keyhintDelay: 500,
};

// "gbo" -> ["g", "b", "o"]; "<c-o>x" -> ["<c-o>", "x"]. A bracketed name is
// one key; its modifiers are lowercased and sorted so <C-A-x> and <a-c-x>
// match the same keypress.
function vimodeTokenize(keys) {
	const tokens = [];
	for (let i = 0; i < keys.length; i++) {
		if (keys[i] === "<") {
			const end = keys.indexOf(">", i);
			if (end > i + 1) {
				tokens.push(vimodeNormalizeToken(keys.slice(i, end + 1)));
				i = end;
				continue;
			}
		}
		tokens.push(keys[i]);
	}
	return tokens;
}

function vimodeNormalizeToken(token) {
	const parts = token.slice(1, -1).split("-");
	let key = parts.pop();
	if (key === "" && parts.length) key = "-";
	const mods = parts.map((m) => m.toLowerCase()).sort();
	if (key.length > 1) key = key.toLowerCase();
	return mods.length || key.length > 1 ? `<${[...mods, key].join("-")}>` : key;
}

// Parses a vimoderc into the keymap. Returns
// { keymap: { "g b o": "closeOtherTabs", ... }, settings, errors }, keys
// joined by spaces, errors as ["line 3", "unknown command: map x foo"].
// Unknown commands and malformed lines are reported in errors and skipped, so
// one typo never takes the whole keymap down.
function vimodeParse(text) {
	const keymap = {};
	const settings = { ...VIMODE_DEFAULT_SETTINGS };
	const errors = [];
	text.split("\n").forEach((raw, n) => {
		const line = raw.trim();
		if (!line || line.startsWith("#") || line.startsWith('"')) return;
		const [cmd, ...args] = line.split(/\s+/);
		const skip = (reason) => errors.push([`line ${n + 1}`, `${reason}: ${line}`]);
		if (cmd === "map" && args.length === 2) {
			if (!(args[1] in VIMODE_COMMANDS)) {
				skip("unknown command");
				return;
			}
			keymap[vimodeTokenize(args[0]).join(" ")] = args[1];
		} else if (cmd === "set" && args.length === 2) {
			const [name, value] = args;
			if (!(name in VIMODE_DEFAULT_SETTINGS)) {
				skip("unknown setting");
				return;
			}
			const kind = typeof VIMODE_DEFAULT_SETTINGS[name];
			settings[name] = kind === "boolean" ? value === "true"
				: kind === "number" ? Number(value) : value;
		} else {
			skip("cannot read");
		}
	});
	return { keymap, settings, errors };
}
