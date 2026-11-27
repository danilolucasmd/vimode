// Shared by the background worker (which parses the config) and the content
// script (which runs the commands): the command names and the config parser.
// There is no built-in keymap: the config file is the whole of it, so a key
// does something only if a `map` line says so. Loaded as a classic script in both, so it only defines
// globals.

// Every command, and where it runs: "page" in the frame the key was pressed
// in, "tab" in the background worker, which owns the tabs API.
const VIMODE_COMMANDS = {
	scrollDown: "page",
	scrollUp: "page",
	scrollLeft: "page",
	scrollRight: "page",
	scrollPageDown: "page",
	scrollPageUp: "page",
	scrollFullPageDown: "page",
	scrollFullPageUp: "page",
	scrollToTop: "page",
	scrollToBottom: "page",
	scrollToLeft: "page",
	scrollToRight: "page",
	goBack: "page",
	goForward: "page",
	goUp: "page",
	goToRoot: "page",
	reload: "page",
	copyCurrentUrl: "page",
	enterInsertMode: "page",
	focusInput: "page",
	nextTab: "tab",
	previousTab: "tab",
	firstTab: "tab",
	lastTab: "tab",
	visitPreviousTab: "tab",
	createTab: "tab",
	duplicateTab: "tab",
	removeTab: "tab",
	restoreTab: "tab",
	togglePinTab: "tab",
	closeOtherTabs: "tab",
	closeTabsOnLeft: "tab",
	closeTabsOnRight: "tab",
	moveTabLeft: "tab",
	moveTabRight: "tab",
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
// joined by spaces. Unknown commands and malformed lines are reported in
// errors and skipped, so one typo never takes the whole keymap down.
function vimodeParse(text) {
	const keymap = {};
	const settings = { ...VIMODE_DEFAULT_SETTINGS };
	const errors = [];
	text.split("\n").forEach((raw, n) => {
		const line = raw.trim();
		if (!line || line.startsWith("#") || line.startsWith('"')) return;
		const [cmd, ...args] = line.split(/\s+/);
		const where = `line ${n + 1}: ${line}`;
		if (cmd === "map" && args.length === 2) {
			if (!(args[1] in VIMODE_COMMANDS)) {
				errors.push(`unknown command, ${where}`);
				return;
			}
			keymap[vimodeTokenize(args[0]).join(" ")] = args[1];
		} else if (cmd === "set" && args.length === 2) {
			const [name, value] = args;
			if (!(name in VIMODE_DEFAULT_SETTINGS)) {
				errors.push(`unknown setting, ${where}`);
				return;
			}
			const kind = typeof VIMODE_DEFAULT_SETTINGS[name];
			settings[name] = kind === "boolean" ? value === "true"
				: kind === "number" ? Number(value) : value;
		} else {
			errors.push(`cannot read, ${where}`);
		}
	});
	return { keymap, settings, errors };
}
