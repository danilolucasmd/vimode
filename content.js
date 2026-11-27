// vimode's content script: the keys, the modes and the status bar.
//
// Modes work the way Vimium's do. Normal mode runs the keymap. Insert mode
// passes every key to the page, and there are two ways into it: focusing
// something editable, or `i` (enterInsertMode). Escape leaves either one, and
// leaving a focused field means blurring it. Keys the keymap does not know go
// to the page in normal mode too, so a site's own shortcuts still work.
//
// Runs in every frame, since the focused element may be in any of them (the
// manifest also matches about:blank and origin-less frames, which is where
// Google Docs puts its typing target). Each frame handles its own keys. The
// status bar is drawn by the top frame only, so subframes report their mode
// to it with postMessage, which crosses origins and needs no background
// worker to relay.

(() => {
	const TAG = "vimode:v1";
	const isTop = window === window.top;

	// ---- config -----------------------------------------------------------

	let keymap = {};
	let prefixes = new Set();
	let settings = { ...VIMODE_DEFAULT_SETTINGS };

	function loadConfig(config) {
		if (!config) return;
		keymap = config.keymap || {};
		settings = { ...VIMODE_DEFAULT_SETTINGS, ...(config.settings || {}) };
		prefixes = new Set();
		for (const keys of Object.keys(keymap)) {
			const tokens = keys.split(" ");
			for (let i = 1; i < tokens.length; i++) prefixes.add(tokens.slice(0, i).join(" "));
		}
	}
	// The last config the host delivered, kept in storage across restarts, so
	// keys work before the host has answered this time.
	chrome.storage.local.get("config").then(({ config }) => loadConfig(config));
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && changes.config) loadConfig(changes.config.newValue);
	});

	// ---- what is editable ---------------------------------------------------

	const TEXT_INPUTS = new Set([
		"text", "search", "email", "url", "tel", "password", "number",
		"date", "datetime-local", "month", "time", "week", "",
	]);

	// The focused element, through any open shadow roots.
	function deepActive() {
		let el = document.activeElement;
		while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
		return el;
	}

	function editable(el) {
		if (!el) return false;
		if (el.isContentEditable) return true;
		if (el.tagName === "TEXTAREA") return !el.readOnly && !el.disabled;
		if (el.tagName === "SELECT") return !el.disabled;
		if (el.tagName === "INPUT") {
			return TEXT_INPUTS.has((el.getAttribute("type") || "").toLowerCase())
				&& !el.readOnly && !el.disabled;
		}
		return false;
	}

	// ---- modes ----------------------------------------------------------------

	// `i` mode, this frame's own. Focus-driven insert mode is read off the DOM
	// whenever it is needed, so there is nothing to keep in sync for it.
	let insertMode = false;
	let pending = [];
	let count = "";

	const insertNow = () => insertMode || editable(deepActive());

	// grabBackFocus: a page that focuses a field on load (a search box,
	// Google Docs' editor) would otherwise start in insert mode and swallow
	// the first keys meant for the keymap. Until the user has pressed a key or
	// clicked, such a focus is undone.
	let userActed = false;
	window.addEventListener("mousedown", () => { userActed = true; }, true);
	window.addEventListener("focusin", (e) => {
		if (!userActed && settings.grabBackFocus && editable(e.target)) e.target.blur();
	}, true);

	// ---- keys -------------------------------------------------------------------

	const NAMED = {
		" ": "space", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up",
		ArrowDown: "down", Enter: "enter", Backspace: "backspace", Tab: "tab",
		Escape: "esc", Delete: "delete", Home: "home", End: "end",
		PageUp: "pageup", PageDown: "pagedown", Insert: "insert",
	};

	// A keydown as a keymap token: "j", "G", "<c-o>", "<a-p>", "<s-left>".
	// Shift is part of a printed character ("G", "$"), so it is only written
	// out for named keys.
	function token(e) {
		if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead"].includes(e.key)) return null;
		let key = NAMED[e.key] || (/^F\d+$/.test(e.key) ? e.key.toLowerCase() : e.key);
		if (key.length > 1 && !NAMED[e.key] && !/^f\d+$/.test(key)) return null;
		const mods = [];
		if (e.altKey) mods.push("a");
		if (e.ctrlKey) mods.push("c");
		if (e.metaKey) mods.push("m");
		if (e.shiftKey && key.length > 1) mods.push("s");
		return mods.length || key.length > 1 ? `<${[...mods, key].join("-")}>` : key;
	}

	function swallow(e) {
		e.preventDefault();
		e.stopImmediatePropagation();
	}

	function reset() {
		pending = [];
		count = "";
	}

	function onKeydown(e) {
		if (e.isComposing) return;
		userActed = true;
		const t = token(e);
		if (!t) return;

		if (t === "<esc>") {
			if (insertMode) {
				insertMode = false;
				swallow(e);
			} else if (editable(deepActive())) {
				deepActive().blur();
				swallow(e);
			} else if (pending.length || count) {
				reset();
				swallow(e);
			}
			changed();
			return;
		}
		if (insertNow()) return;

		// A count: digits before a command, as in 5j. A leading 0 is a key of
		// its own, so it only extends a count already started.
		if (!pending.length && /^[0-9]$/.test(t) && (count || t !== "0") && !(t in keymap)) {
			count += t;
			swallow(e);
			changed();
			return;
		}

		const seq = [...pending, t].join(" ");
		if (seq in keymap) {
			swallow(e);
			const command = keymap[seq];
			const n = Math.max(1, parseInt(count, 10) || 1);
			reset();
			run(command, n);
		} else if (prefixes.has(seq)) {
			swallow(e);
			pending.push(t);
		} else if (pending.length || count) {
			// A sequence that went nowhere starts over from this key, as in
			// Vimium: after "g", "j" still scrolls.
			reset();
			onKeydown(e);
			return;
		}
		changed();
	}
	window.addEventListener("keydown", onKeydown, true);

	// ---- commands ---------------------------------------------------------------

	const scroller = () => document.scrollingElement || document.documentElement;
	const by = (x, y) => window.scrollBy({ left: x, top: y, behavior: "instant" });
	const to = (x, y) => window.scrollTo({ left: x, top: y, behavior: "instant" });

	const pageCommands = {
		scrollDown: (n) => by(0, settings.scrollStepSize * n),
		scrollUp: (n) => by(0, -settings.scrollStepSize * n),
		scrollLeft: (n) => by(-settings.scrollStepSize * n, 0),
		scrollRight: (n) => by(settings.scrollStepSize * n, 0),
		scrollPageDown: (n) => by(0, (window.innerHeight / 2) * n),
		scrollPageUp: (n) => by(0, -(window.innerHeight / 2) * n),
		scrollFullPageDown: (n) => by(0, window.innerHeight * n),
		scrollFullPageUp: (n) => by(0, -window.innerHeight * n),
		scrollToTop: () => to(window.scrollX, 0),
		scrollToBottom: () => to(window.scrollX, scroller().scrollHeight),
		scrollToLeft: () => to(0, window.scrollY),
		scrollToRight: () => to(scroller().scrollWidth, window.scrollY),
		goBack: (n) => history.go(-n),
		goForward: (n) => history.go(n),
		goUp: (n) => {
			const url = new URL(location.href);
			const parts = url.pathname.split("/").filter(Boolean);
			url.pathname = "/" + parts.slice(0, Math.max(0, parts.length - n)).join("/");
			url.search = "";
			url.hash = "";
			location.href = url.href;
		},
		goToRoot: () => { location.href = location.origin + "/"; },
		reload: () => location.reload(),
		copyCurrentUrl: () => {
			navigator.clipboard.writeText(location.href).then(
				() => flash(`Yanked ${location.href}`),
				() => flash("Could not copy the URL"),
			);
		},
		enterInsertMode: () => { insertMode = true; },
		focusInput: (n) => {
			const visible = (el) => {
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
			};
			const inputs = [...document.querySelectorAll("input, textarea, [contenteditable]")]
				.filter((el) => editable(el) && visible(el));
			const el = inputs[Math.min(n, inputs.length) - 1];
			if (el) el.focus();
		},
	};

	function run(command, n) {
		if (VIMODE_COMMANDS[command] === "tab") {
			chrome.runtime.sendMessage({ tabCommand: command, count: n }).catch(() => {});
		} else if (pageCommands[command]) {
			pageCommands[command](n);
		}
		changed();
	}

	// ---- reporting, and the bar ---------------------------------------------------

	const frameState = () => ({
		insert: document.hasFocus() && insertNow(),
		keys: count + pending.join(""),
	});

	let flashText = "";
	let flashTimer = null;
	function flash(text) {
		if (!isTop) {
			window.top.postMessage({ [TAG]: { flash: text } }, "*");
			return;
		}
		flashText = text;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => { flashText = ""; render(); }, 2000);
		render();
	}

	// focusout fires before focus lands on the next element, so the check
	// waits a tick rather than flashing "normal" between fields.
	const changed = () => setTimeout(isTop ? render : report, 0);
	const report = () => window.top.postMessage({ [TAG]: frameState() }, "*");

	for (const ev of ["focusin", "focusout", "focus", "blur"]) {
		window.addEventListener(ev, changed, true);
	}
	document.addEventListener("visibilitychange", changed);
	document.addEventListener("fullscreenchange", changed);
	// A backstop for focus changes no event announces (an element removed
	// while focused, a tab switch), and what keeps the URL current on pages
	// that change it with pushState. Only a page on screen does any work.
	setInterval(() => { if (!document.hidden) changed(); }, 250);

	if (!isTop) return;

	// Top frame: its own state plus every subframe's last report, keyed by the
	// frame's window so a frame that reports twice replaces its old one.
	const frames = new Map();
	window.addEventListener("message", (e) => {
		const msg = e.data && typeof e.data === "object" ? e.data[TAG] : undefined;
		if (!msg || typeof msg !== "object") return;
		if (typeof msg.flash === "string") flash(msg.flash);
		else frames.set(e.source, msg);
		changed();
	});

	// The link under the pointer, if any. Only this frame's links: one inside
	// an iframe is not seen, which qutebrowser does not manage either.
	let hovered = null;
	document.addEventListener("mouseover", (e) => {
		const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
		const next = a ? a.href : null;
		if (next !== hovered) {
			hovered = next;
			changed();
		}
	}, true);

	// qutebrowser's {url:pretty}: percent-escapes decoded so the address reads
	// as text, left encoded where decoding would fail.
	function pretty(href) {
		try {
			return decodeURI(href);
		} catch {
			return href;
		}
	}

	// A full-width strip along the bottom, in qutebrowser's statusbar colours
	// from its config.py: plain grey in normal mode, GREEN with "-- INSERT --"
	// on ON_ACCENT in insert mode. The right side holds pending keys and the
	// URL: FG for http, GREEN for https, BLUE for a hovered link, which
	// replaces the page's URL while the pointer is on it. In insert mode a
	// GREEN https URL would vanish into the bar, so there it takes the label's
	// colour; a hovered link stays BLUE. It overlays the page rather than
	// shrinking it (an extension cannot resize the viewport), and clicks pass
	// through it.
	let host = null;
	function bar() {
		if (host) return host;
		host = document.createElement("vimode-bar");
		const root = host.attachShadow({ mode: "closed" });
		root.innerHTML = `<style>
			:host { all: initial; }
			div {
				position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
				box-sizing: border-box; height: 20px; padding: 0 8px;
				display: flex; gap: 16px;
				background: #3a3a3a; color: #dddddd;
				font: 600 11px/20px "JetBrainsMono Nerd Font", "JetBrains Mono", monospace;
				pointer-events: none;
			}
			span { white-space: nowrap; }
			.mode, .keys { flex: none; }
			.url { flex: 1; min-width: 0; text-align: right; overflow: hidden; text-overflow: ellipsis; }
			.url.https { color: #a6e3a1; }
			.url.hover { color: #89b4fa; }
			div.insert { background: #a6e3a1; color: #1e1b22; }
			div.insert .url:not(.hover) { color: #1e1b22; }
		</style><div><span class="mode"></span><span class="url"></span><span class="keys"></span></div>`;
		host.box = root.querySelector("div");
		host.mode = root.querySelector(".mode");
		host.url = root.querySelector(".url");
		host.keys = root.querySelector(".keys");
		return host;
	}

	const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

	function render() {
		const own = frameState();
		let insert = own.insert;
		let keys = own.keys;
		for (const [win, state] of frames) {
			if (win.closed) {
				frames.delete(win);
				continue;
			}
			if (state.insert) insert = true;
			if (state.keys) keys = state.keys;
		}
		const b = bar();
		const html = document.documentElement;
		if (!b.isConnected && html) html.append(b);
		b.box.classList.toggle("insert", insert);
		setText(b.mode, insert ? "-- INSERT --" : "");
		setText(b.keys, keys);
		setText(b.url, flashText || pretty(hovered || location.href));
		b.url.classList.toggle("hover", !flashText && hovered !== null);
		b.url.classList.toggle("https", !flashText && location.protocol === "https:");
		// Out of the way of fullscreen video and presentations.
		b.box.style.display = document.fullscreenElement ? "none" : "flex";
		// Dark Reader's filter mode (its choice on Google Docs) inverts the
		// whole page with a CSS filter on <html>, bar included. Inverting it
		// back keeps the colours right.
		const inverted = html && html.getAttribute("data-darkreader-mode") === "filter";
		b.box.style.filter = inverted ? "invert(100%) hue-rotate(180deg)" : "";
	}
})();
