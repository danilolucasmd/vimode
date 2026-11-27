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
	// style.css from beside the config, for the hints.
	let userCss = "";

	function loadConfig(config) {
		if (!config) return;
		keymap = { ...(config.keymap || {}) };
		// A way back from any config: when nothing maps the command line, `:`
		// does (if it is free), so :importConfig and :importDefaults are
		// always reachable. This also covers the time before the defaults are
		// stored on install.
		if (!Object.values(keymap).includes("enterCommandMode") && !(":" in keymap)) {
			keymap[":"] = "enterCommandMode";
		}
		userCss = config.css || "";
		if (hintStyle) hintStyle.textContent = HINT_CSS + userCss;
		settings = { ...VIMODE_DEFAULT_SETTINGS, ...(config.settings || {}) };
		prefixes = new Set();
		for (const keys of Object.keys(keymap)) {
			const tokens = keys.split(" ");
			for (let i = 1; i < tokens.length; i++) prefixes.add(tokens.slice(0, i).join(" "));
		}
	}
	chrome.storage.local.get("config").then(({ config }) => loadConfig(config || {}));
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
		if (commandKey(e)) return;
		if (helpKey(e)) return;
		if (hintMode) {
			hintKeydown(e);
			return;
		}
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
			} else if (findEscape()) {
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
		} else if (!settings.passUnmappedKeys && t.length === 1) {
			swallow(e);
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
		enterCommandMode: () => openCommandLine(),
		showHelp: () => toggleHelp(),
		enterFindMode: () => openFind(),
		importConfig: () => importConfig(),
		open: () => openPrompt("command", "open "),
		openInNewTab: () => openPrompt("command", "open -t "),
		// The address bar's Ctrl+L: the URL is there to edit, and selected,
		// so typing straight away replaces it.
		editUrl: () => {
			openPrompt("command", `open ${location.href}`);
			bar().input.setSelectionRange("open ".length, bar().input.value.length);
		},
		exportConfig: () => exportConfig(),
		importDefaults: () => {
			chrome.runtime.sendMessage({ importDefaults: true })
				.catch(() => false)
				.then((ok) => flash(ok ? "Loaded the default keymap" : "Could not load the default keymap"));
		},
		performFind: (n) => findNext(n, 1),
		performBackwardsFind: (n) => findNext(n, -1),
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
		const where = VIMODE_COMMANDS[command] && VIMODE_COMMANDS[command].where;
		if (where === "tab") {
			chrome.runtime.sendMessage({ tabCommand: command, count: n }).catch(() => {});
		} else if (where === "hints") {
			chrome.runtime.sendMessage({ hintsStart: command }).catch(() => {});
		} else if (TOP_ONLY.has(command) && !isTop) {
			window.top.postMessage({ [TAG]: { topCommand: command, count: n } }, "*");
		} else if (pageCommands[command]) {
			pageCommands[command](n);
		}
		changed();
	}

	// Drawn by the top frame (the command line, the help screen) or kept there
	// (the search, which covers the top document only), so a subframe hands
	// them up.
	const TOP_ONLY = new Set(["enterCommandMode", "showHelp", "importConfig", "exportConfig", "open", "openInNewTab", "editUrl", "enterFindMode", "performFind", "performBackwardsFind"]);

	// ---- link hints ---------------------------------------------------------------
	//
	// Vimium's, frame by frame. The background worker (see "link hints" there)
	// asks every frame to collect what it would hint, deals out the hint
	// strings, and relays the typed keys; each frame draws its own labels,
	// narrows them, and activates its element when the match is one of its
	// own. Keys are sent from whichever frame has focus.

	let hintMode = false;
	let candidates = [];
	let markers = [];
	let hintHost = null;
	let hintLayer = null;
	let hintStyle = null;

	// What Vimium hints: links, form controls, and anything a page has marked
	// as clickable by role, handler, tabindex or Google's jsaction.
	const CLICKABLE = [
		"a[href]", "area[href]", "button", "input:not([type=hidden])", "select", "textarea",
		"summary", "label[for]", "[onclick]", "[contenteditable]:not([contenteditable=false])",
		"[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=tab]",
		"[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=option]",
		"[role=switch]", "[role=treeitem]", "[role=combobox]", "[tabindex]:not([tabindex='-1'])",
		"[jsaction*='click']", "video[controls]", "audio[controls]",
	].join(",");

	// Vimium's default hint look: yellow gradient labels, dark bold capitals,
	// typed characters faded. The user's style.css is appended after it, so
	// any rule here can be overridden from the dotfiles. Matched characters
	// carry .matched; each label is a .vimode-hint of one span per character.
	const HINT_CSS = `
		:host { all: initial; }
		.layer { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
		.vimode-hint {
			position: fixed; display: block; white-space: nowrap; overflow: hidden;
			padding: 1px 3px 0 3px; border: solid 1px #c38a22; border-radius: 3px;
			background: linear-gradient(to bottom, #fff785 0%, #ffc542 100%);
			box-shadow: 0 3px 7px 0 rgba(0, 0, 0, 0.3);
			font: bold 11px Helvetica, Arial, sans-serif; line-height: normal;
			color: #302505; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
		}
		.vimode-hint .matched { color: #d4ac3a; }
	`;

	// Every root to search: the document and each open shadow root in it.
	function roots(root, out = []) {
		out.push(root);
		for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots(el.shadowRoot, out);
		return out;
	}

	// A frame scrolled out of its parent, or hidden offscreen as Google Docs
	// does with its typing frame, hints nothing. A cross-origin frame cannot
	// see its own frame element, so it is taken as visible.
	function frameVisible() {
		if (document.hidden || !innerWidth || !innerHeight) return false;
		try {
			const fe = window.frameElement;
			if (fe) {
				const r = fe.getBoundingClientRect();
				const pw = fe.ownerDocument.defaultView;
				if (r.width < 3 || r.height < 3 || r.bottom <= 0 || r.right <= 0
					|| r.top >= pw.innerHeight || r.left >= pw.innerWidth) return false;
			}
		} catch {}
		return true;
	}

	function clip(r) {
		const box = {
			left: Math.max(0, r.left), top: Math.max(0, r.top),
			right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom),
		};
		return box.right - box.left >= 3 && box.bottom - box.top >= 3 ? box : null;
	}

	// The first on-screen box of an element. A link wrapping block content
	// (an image, a card) often has no box of its own, so its children's count.
	function visibleRect(el) {
		for (const r of el.getClientRects()) {
			const box = clip(r);
			if (box) return box;
		}
		for (const child of el.children) {
			for (const r of child.getClientRects()) {
				const box = clip(r);
				if (box) return box;
			}
		}
		return null;
	}

	// Covered by something else (a modal, a sticky header) means not hinted.
	function unobscured(el, rect, root) {
		const points = [
			[(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
			[rect.left + 2, rect.top + 2],
		];
		for (const [x, y] of points) {
			const hit = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
			if (hit && (hit === el || el.contains(hit) || hit.contains(el))) return true;
		}
		return false;
	}

	function collect() {
		candidates = [];
		if (!frameVisible()) return 0;
		const found = [];
		for (const root of roots(document)) {
			for (const el of root.querySelectorAll(CLICKABLE)) {
				if (el.disabled || getComputedStyle(el).visibility !== "visible") continue;
				const rect = visibleRect(el);
				if (rect && unobscured(el, rect, root)) found.push({ el, rect });
			}
		}
		// A clickable inside another with the same box is one target, as
		// Vimium treats it: keep the outer one.
		const byEl = new Map(found.map((c) => [c.el, c]));
		const same = (a, b) => ["left", "top", "right", "bottom"].every((k) => Math.abs(a[k] - b[k]) < 2);
		candidates = found.filter(({ el, rect }) => {
			for (let p = el.parentElement; p; p = p.parentElement) {
				const outer = byEl.get(p);
				if (outer && same(outer.rect, rect)) return false;
			}
			return true;
		});
		return candidates.length;
	}

	function layer() {
		if (hintHost) return hintLayer;
		hintHost = document.createElement("vimode-hints");
		const root = hintHost.attachShadow({ mode: "closed" });
		hintStyle = document.createElement("style");
		hintStyle.textContent = HINT_CSS + userCss;
		hintLayer = document.createElement("div");
		hintLayer.className = "layer";
		root.append(hintStyle, hintLayer);
		(document.documentElement || document).append(hintHost);
		// Dark Reader's filter mode inverts the page, labels included.
		const html = document.documentElement;
		if (html && html.getAttribute("data-darkreader-mode") === "filter") {
			hintLayer.style.filter = "invert(100%) hue-rotate(180deg)";
		}
		return hintLayer;
	}

	function removeLayer() {
		if (hintHost) hintHost.remove();
		hintHost = hintLayer = hintStyle = null;
		markers = [];
	}

	function showHints(hints) {
		removeLayer();
		hintMode = true;
		reset();
		if (hints.length) {
			const l = layer();
			markers = hints.map((hint, i) => {
				const { el, rect } = candidates[i];
				const node = document.createElement("div");
				node.className = "vimode-hint";
				node.style.left = `${rect.left}px`;
				node.style.top = `${rect.top}px`;
				for (const ch of hint.toUpperCase()) {
					const span = document.createElement("span");
					span.textContent = ch;
					node.append(span);
				}
				l.append(node);
				return { el, node, hint };
			});
		}
		changed();
	}

	function filterHints(typed) {
		for (const m of markers) {
			const on = m.hint.startsWith(typed);
			m.node.style.display = on ? "" : "none";
			[...m.node.children].forEach((span, i) => span.classList.toggle("matched", on && i < typed.length));
		}
	}

	// Space, as in Vimium: labels that overlap change which is on top.
	function rotateHints() {
		if (hintLayer) hintLayer.append(...[...hintLayer.children].reverse());
	}

	function exitHints() {
		hintMode = false;
		candidates = [];
		removeLayer();
		changed();
	}

	function hintKeydown(e) {
		swallow(e);
		if (e.repeat && e.key === "Shift") return;
		const key = e.key === "Shift" ? "ShiftDown"
			: e.key === " " ? "Space"
			: ["Escape", "Backspace"].includes(e.key) ? e.key
			: e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey ? e.key
			: null;
		if (key) chrome.runtime.sendMessage({ hintsKey: key }).catch(() => {});
	}
	window.addEventListener("keyup", (e) => {
		if (hintMode && e.key === "Shift") {
			swallow(e);
			chrome.runtime.sendMessage({ hintsKey: "ShiftUp" }).catch(() => {});
		}
	}, true);
	// A click anywhere ends hint mode, as Escape would.
	window.addEventListener("mousedown", () => {
		if (hintMode) chrome.runtime.sendMessage({ hintsKey: "Escape" }).catch(() => {});
	}, true);

	// Vimium's DomUtils.simulateClick: the whole pointer sequence, so handlers
	// listening for mousedown or pointerup fire as well as onclick ones.
	function simulateClick(el, mods = {}) {
		for (const type of ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
			const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
			el.dispatchEvent(new Event(type, {
				bubbles: true, cancelable: true, composed: true, view: window, button: 0, ...mods,
			}));
		}
	}

	// A brief outline around what was picked, as Vimium shows.
	function flashElement(el) {
		const r = visibleRect(el);
		if (!r) return;
		const host = document.createElement("vimode-hints");
		const box = document.createElement("div");
		Object.assign(box.style, {
			position: "fixed", left: `${r.left}px`, top: `${r.top}px`,
			width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px`,
			border: "2px solid #ff8040", borderRadius: "3px", boxSizing: "border-box",
			zIndex: "2147483647", pointerEvents: "none",
		});
		host.attachShadow({ mode: "closed" }).append(box);
		(document.documentElement || document).append(host);
		setTimeout(() => host.remove(), 400);
	}

	function activateHint(index, mode) {
		const m = markers[index];
		if (!m) return;
		const el = m.el;
		userActed = true;
		flashElement(el);
		const link = el.closest("a[href], area[href]");
		const url = link && link.href && !/^javascript:/i.test(link.href) ? link.href : null;
		if (mode === "copy") {
			if (!url) return flash("No link to copy");
			navigator.clipboard.writeText(url).then(() => flash(`Yanked ${url}`), () => flash("Could not copy the link"));
		} else if (mode === "newTab" || mode === "newForegroundTab" || mode === "queue") {
			if (url) chrome.runtime.sendMessage({ openUrl: url, active: mode === "newForegroundTab" }).catch(() => {});
			else simulateClick(el, { ctrlKey: true, shiftKey: mode === "newForegroundTab" });
		} else if (mode === "download") {
			simulateClick(el, { altKey: true });
		} else if (editable(el) || el.tagName === "SELECT") {
			el.focus();
		} else {
			simulateClick(el);
			if (el.matches("button, input, [tabindex]")) el.focus({ preventScroll: true });
		}
	}

	chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
		const h = msg && msg.vimodeHints;
		if (!h) return;
		if (h.op === "collect") return sendResponse({ count: collect() });
		if (h.op === "show") showHints(h.hints);
		else if (h.op === "filter") filterHints(h.typed);
		else if (h.op === "rotate") rotateHints();
		else if (h.op === "activate") activateHint(h.index, h.mode);
		else if (h.op === "exit") exitHints();
		else if (h.op === "flash") flash(h.text);
		sendResponse({});
	});

	// ---- reporting, and the bar ---------------------------------------------------

	const frameState = () => ({
		insert: document.hasFocus() && insertNow(),
		keys: count + pending.join(""),
		pending: [...pending],
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

	// Replaced in the top frame, the only one with a command line and a help
	// screen.
	let commandKey = () => false;
	let helpKey = () => false;
	let findEscape = () => false;

	if (!isTop) return;

	// Top frame: its own state plus every subframe's last report, keyed by the
	// frame's window so a frame that reports twice replaces its old one.
	const frames = new Map();
	window.addEventListener("message", (e) => {
		const msg = e.data && typeof e.data === "object" ? e.data[TAG] : undefined;
		if (!msg || typeof msg !== "object") return;
		if (typeof msg.flash === "string") flash(msg.flash);
		else if (TOP_ONLY.has(msg.topCommand)) run(msg.topCommand, Math.max(1, Number(msg.count) || 1));
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
			.bar {
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
			.bar.insert { background: #a6e3a1; color: #1e1b22; }
			.bar.insert .url:not(.hover) { color: #1e1b22; }
			.cmd { display: none; flex: 1; min-width: 0; }
			.cmd input {
				all: unset; flex: 1; min-width: 0; color: #dddddd; caret-color: #dddddd;
				font: inherit; pointer-events: auto;
			}
			.cmd .count { flex: none; padding-left: 16px; }
			.cmd .count.none { color: #f38ba8; }
			.bar.command { background: #2c292f; }
			.bar.command .cmd { display: flex; }
			.bar.command .mode, .bar.command .url, .bar.command .keys { display: none; }
			.completion {
				position: fixed; left: 0; right: 0; bottom: 20px; z-index: 2147483647;
				height: 40vh; overflow-y: auto; display: none;
				background: #2c292f; color: #dddddd;
				font: 11px/18px "JetBrainsMono Nerd Font", "JetBrains Mono", monospace;
				pointer-events: none;
			}
			.completion.open { display: block; }
			.keyhint {
				position: fixed; left: 0; bottom: 20px; z-index: 2147483647;
				display: none; padding: 4px 10px; border-top-right-radius: 6px;
				background: #2c292fee; color: #dddddd;
				font: 11px/17px "JetBrainsMono Nerd Font", "JetBrains Mono", monospace;
				pointer-events: none;
			}
			.keyhint.open { display: grid; grid-template-columns: auto auto; column-gap: 24px; }
			.keyhint .typed { color: #8a8590; }
			.help {
				position: fixed; inset: 0; z-index: 2147483647; display: none;
				align-items: center; justify-content: center;
				background: rgba(0, 0, 0, 0.45); pointer-events: auto;
			}
			.help.open { display: flex; }
			.help .panel {
				width: min(920px, calc(100vw - 48px)); max-height: calc(100vh - 96px);
				overflow-y: auto; overflow-x: hidden;
				box-sizing: border-box; padding: 18px 24px; border-radius: 10px;
				background: #2c292f; color: #dddddd; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
				font: 12px/20px "JetBrainsMono Nerd Font", "JetBrains Mono", monospace;
			}
			.help h1 { margin: 0 0 12px; font-size: 15px; color: #cba6f7; }
			.help .groups { columns: 2 380px; column-gap: 32px; }
			.help section { break-inside: avoid; margin-bottom: 16px; }
			.help h2 {
				margin: 0 0 4px; padding-bottom: 2px; font-size: 12px; color: #cba6f7;
				border-bottom: 1px solid #4a4452;
			}
			.help .row { display: grid; grid-template-columns: 11ch minmax(0, 1fr); column-gap: 12px; }
			.help .row span:last-child { white-space: normal; }
			.help .keys { color: #a6e3a1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.help .hint { margin-top: 4px; color: #8a8590; }
			.keyhint .rest { color: #cba6f7; font-weight: 600; }
			.completion .category {
				padding: 0 8px; background: #231f26; color: #cba6f7; font-weight: 600;
				border-top: 1px solid #231f26; border-bottom: 1px solid #231f26;
			}
			.completion .row { display: flex; gap: 16px; padding: 0 8px; white-space: nowrap; }
			.completion .row.selected { background: #3d3744; color: #ffffff; }
			.completion .name { flex: none; width: 22ch; overflow: hidden; text-overflow: ellipsis; }
			.completion .desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
			.completion .bind { flex: none; color: #8a8590; }
			.completion.urls .name { flex: 1 1 0; width: auto; }
			.completion.urls .desc { flex: 1 1 0; color: #b0aab8; }
			.completion.urls .row.selected .desc { color: #ffffff; }
			.completion .match { color: #cba6f7; }
		</style>
		<div class="completion"></div>
		<div class="keyhint"></div>
		<div class="help"><div class="panel"></div></div>
		<div class="bar"><span class="cmd"><span class="prefix">:</span><input spellcheck="false" autocomplete="off"><span class="count"></span></span><span class="mode"></span><span class="url"></span><span class="keys"></span></div>`;
		host.box = root.querySelector(".bar");
		host.completion = root.querySelector(".completion");
		host.keyhint = root.querySelector(".keyhint");
		host.help = root.querySelector(".help");
		host.help.addEventListener("mousedown", (e) => {
			if (e.target === host.help) closeHelp();
		});
		host.input = root.querySelector(".cmd input");
		host.mode = root.querySelector(".mode");
		host.url = root.querySelector(".url");
		host.keys = root.querySelector(".keys");
		host.promptPrefix = root.querySelector(".cmd .prefix");
		host.count = root.querySelector(".cmd .count");
		host.input.addEventListener("input", (e) => {
			typed = host.input.value;
			// Deleting never brings an inline completion back, as in the
			// browser's own address bar: Backspace would just re-add it.
			deleting = !!(e.inputType && e.inputType.startsWith("delete"));
			if (promptKind === "find") {
				findType(typed);
				return;
			}
			selected = -1;
			renderCompletion();
		});
		// Clicking away from a search keeps it, as Enter does.
		host.input.addEventListener("blur", () => {
			// Clicked away: focus went where the click put it, so it is not
			// given back.
			if (commandOpen) returnFocus = null;
			if (promptKind === "find") acceptFind();
			else closeCommandLine();
		});
		return host;
	}

	const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

	function render() {
		const own = frameState();
		let insert = own.insert;
		let keys = own.keys;
		let pendingTokens = own.pending;
		for (const [win, state] of frames) {
			if (win.closed) {
				frames.delete(win);
				continue;
			}
			if (state.insert) insert = true;
			if (state.keys) keys = state.keys;
			if (state.pending && state.pending.length) pendingTokens = state.pending;
		}
		const b = bar();
		const html = document.documentElement;
		if (!b.isConnected && html) html.append(b);
		// Every frame is sent the hints, so the top frame's own hintMode covers
		// the tab. Hints take keys even from a focused field, so they win.
		b.box.classList.toggle("insert", insert && !hintMode && !commandOpen);
		b.box.classList.toggle("command", commandOpen);
		setText(b.mode, hintMode ? "-- HINT --" : insert ? "-- INSERT --" : "");
		setText(b.keys, keys || findStatus());
		setText(b.count, promptKind === "find" ? findStatus() || (typed ? "[0/0]" : "") : "");
		b.count.classList.toggle("none", promptKind === "find" && !!typed && !findMatches.length);
		keyhint(b, commandOpen ? [] : pendingTokens);
		setText(b.url, flashText || pretty(hovered || location.href));
		b.url.classList.toggle("hover", !flashText && hovered !== null);
		b.url.classList.toggle("https", !flashText && location.protocol === "https:");
		// Out of the way of fullscreen video and presentations.
		b.box.style.display = document.fullscreenElement && !commandOpen ? "none" : "flex";
		// Dark Reader's filter mode (its choice on Google Docs) inverts the
		// whole page with a CSS filter on <html>, bar included. Inverting it
		// back keeps the colours right.
		const inverted = html && html.getAttribute("data-darkreader-mode") === "filter";
		b.box.style.filter = inverted ? "invert(100%) hue-rotate(180deg)" : "";
		b.completion.style.filter = b.box.style.filter;
	}

	// ---- the help screen -----------------------------------------------------------
	//
	// Vimium's `?`: every mapped key, grouped under the headings commands.js
	// gives them, with each command's description. Escape or showHelp's key
	// closes it, as does a click outside the panel; j and k scroll it. It is
	// built from the current keymap each time it opens, so it never lags
	// behind an import.

	let helpOpen = false;

	function toggleHelp() {
		if (helpOpen) closeHelp();
		else openHelp();
	}

	function openHelp() {
		const b = bar();
		const byCommand = bindings();
		const groups = new Map(["Modes", "Scrolling", "Navigation", "Find", "Tabs", "Link hints", "Vimode"].map((g) => [g, []]));
		for (const [name, { desc, group }] of Object.entries(VIMODE_COMMANDS)) {
			if (!byCommand[name]) continue;
			if (!groups.has(group)) groups.set(group, []);
			groups.get(group).push([byCommand[name].join(" "), desc]);
		}
		showPanel("Vimode", groups, "Escape closes this. j and k scroll it.");
	}

	// The help screen's overlay, also used to list what an import skipped:
	// a title, then sections of [left, right] rows in two columns.
	function showPanel(heading, groups, footer) {
		const b = bar();
		const panel = b.help.querySelector(".panel");
		panel.replaceChildren();
		const title = document.createElement("h1");
		title.textContent = heading;
		const columns = document.createElement("div");
		columns.className = "groups";
		for (const [group, rows] of groups) {
			if (!rows.length) continue;
			const section = document.createElement("section");
			const h = document.createElement("h2");
			h.textContent = group;
			section.append(h);
			for (const [keys, desc] of rows) {
				const row = document.createElement("div");
				row.className = "row";
				const k = document.createElement("span");
				k.className = "keys";
				k.textContent = keys;
				k.title = keys;
				const d = document.createElement("span");
				d.textContent = desc;
				row.append(k, d);
				section.append(row);
			}
			columns.append(section);
		}
		const foot = document.createElement("div");
		foot.className = "hint";
		foot.textContent = footer;
		panel.append(title, columns, foot);
		panel.scrollTop = 0;
		b.help.style.filter = b.box.style.filter;
		b.help.classList.add("open");
		helpOpen = true;
		// Keys for the help screen are read here, in the top frame, so focus
		// comes out of any iframe it was in (Google Docs' editor, say).
		leaveFrame();
	}

	// ---- importing the config -------------------------------------------------
	//
	// A file picker, since an extension cannot read files on disk by path. A
	// file ending in .css is taken as the styles, anything else as the keymap,
	// and a file not picked keeps what was imported before; the raw texts are
	// kept in storage for that. Every tab picks the new config up from
	// storage. A picker needs a user gesture, which the key that ran the
	// command is (an iframe's gesture counts for the top frame too).

	// A config file's text, or { error } for one that cannot be: too big, or
	// not text (a zip, an image) by its NUL bytes or invalid UTF-8.
	const CONFIG_MAX_BYTES = 256 * 1024;
	async function readConfigFile(file) {
		if (file.size > CONFIG_MAX_BYTES) return { error: "is too big for a config" };
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (bytes.includes(0)) return { error: "is not a text file" };
		try {
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return { error: "is not a text file" };
		}
	}

	function importConfig() {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.addEventListener("change", async () => {
			const { source = {} } = await chrome.storage.local.get("source");
			const names = [];
			let keymapPicked = false;
			for (const file of input.files) {
				const text = await readConfigFile(file);
				if (typeof text !== "string") {
					flash(`Not imported: ${file.name} ${text.error}; the current config is kept`);
					return;
				}
				if (file.name.toLowerCase().endsWith(".css")) source.css = { name: file.name, text };
				else {
					source.keymap = { name: file.name, text };
					keymapPicked = true;
				}
				names.push(file.name);
			}
			if (!names.length) return;
			// A keymap that maps nothing is almost surely the wrong file, and
			// would leave every key dead.
			if (keymapPicked && !Object.keys(vimodeParse(source.keymap.text).keymap).length) {
				flash(`Not imported: ${source.keymap.name} maps no keys; the current config is kept`);
				return;
			}
			const parsed = await vimodeSaveConfig(source);
			const skipped = parsed.errors.length;
			flash(`Imported ${names.join(", ")}${skipped ? `, skipped ${skipped} line${skipped > 1 ? "s" : ""}` : ""}`);
			if (skipped) {
				showPanel("Import", new Map([[source.keymap.name, parsed.errors]]), "These lines were skipped; the rest loaded. Escape closes this.");
			}
		});
		input.click();
	}

	// The stored files as downloads, keymap as vimoderc: a starting point for
	// your own config, the defaults included. A download link rather than the
	// downloads API, which would be one more permission. A text/plain blob
	// would be saved as vimoderc.txt.
	async function exportConfig() {
		const { source = {} } = await chrome.storage.local.get("source");
		const files = [];
		if (source.keymap) files.push(["vimoderc", source.keymap.text]);
		if (source.css) files.push(["style.css", source.css.text]);
		if (!files.length) {
			flash("Nothing to export; :importDefaults loads the defaults");
			return;
		}
		for (const [name, text] of files) {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
			a.download = name;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		}
		flash(`Exported ${files.map(([name]) => name).join(", ")}`);
	}

	function closeHelp() {
		helpOpen = false;
		bar().help.classList.remove("open");
	}

	helpKey = (e) => {
		if (!helpOpen) return false;
		const t = token(e);
		if (!t) return true;
		swallow(e);
		const panel = bar().help.querySelector(".panel");
		const showHelpKeys = Object.entries(keymap).filter(([, c]) => c === "showHelp").map(([k]) => k);
		if (t === "<esc>" || showHelpKeys.includes(t)) {
			// See returnFocus.
			closingKeys.add(e.code);
			closeHelp();
		}
		else if (t === "j" || t === "<down>") panel.scrollBy(0, 60);
		else if (t === "k" || t === "<up>") panel.scrollBy(0, -60);
		return true;
	};

	// ---- the key hint -------------------------------------------------------------
	//
	// qutebrowser's keyhint: once a key sequence is half typed ("b", "gb"), a
	// panel above the bar lists every mapping that continues it, the typed
	// part dimmed, the rest highlighted, and each one's command. It waits
	// keyhintDelay ms (qutebrowser's 500 by default) so that a sequence typed
	// without hesitating never flashes it; a negative delay turns it off.

	let keyhintFor = "";
	let keyhintShown = false;
	let keyhintTimer = null;

	function keyhint(b, tokens) {
		const key = tokens.join(" ");
		if (key !== keyhintFor) {
			keyhintFor = key;
			keyhintShown = false;
			clearTimeout(keyhintTimer);
			if (key && settings.keyhintDelay >= 0) {
				keyhintTimer = setTimeout(() => {
					keyhintShown = true;
					render();
				}, settings.keyhintDelay);
			}
		}
		const list = b.keyhint;
		if (!key || !keyhintShown) {
			list.classList.remove("open");
			return;
		}
		const rows = Object.entries(keymap)
			.filter(([keys]) => keys.startsWith(key + " "))
			.sort(([a], [b2]) => a.localeCompare(b2));
		if (list.dataset.for !== key) {
			list.dataset.for = key;
			list.replaceChildren();
			for (const [keys, command] of rows) {
				const k = document.createElement("span");
				const typed = document.createElement("span");
				typed.className = "typed";
				typed.textContent = tokens.join("");
				const rest = document.createElement("span");
				rest.className = "rest";
				rest.textContent = keys.split(" ").slice(tokens.length).join("");
				k.append(typed, rest);
				const c = document.createElement("span");
				c.textContent = command;
				list.append(k, c);
			}
		}
		list.classList.toggle("open", rows.length > 0);
		list.style.filter = b.box.style.filter;
	}

	// ---- find mode ---------------------------------------------------------------
	//
	// `/` opens a prompt in the bar; every match on the page is highlighted as
	// you type, the first one at or below where you were scrolled is the
	// current one (in orange) and is brought into view. Enter keeps the
	// highlights, and focuses the current match's link when it is inside one,
	// so a second Enter follows it; Escape puts the page back where it was.
	// performFind and performBackwardsFind step through the last search,
	// wrapping at the ends, and Escape in normal mode clears the highlights.
	// Lowercase searches ignore case, any capital makes them exact (smartcase).
	//
	// The matches are found in the page's text nodes rather than with
	// window.find, which moves the selection (and focus with it) out of the
	// prompt, and drawn with the CSS Custom Highlight API, which never touches
	// the page's DOM. Only the top document is searched: text in iframes, in
	// shadow roots, or drawn on a canvas (Google Docs) is not found.

	const FIND_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT", "OPTION"]);
	const FIND_CSS = `
		::highlight(vimode-find) { background-color: #f9e2af; color: #1e1b22; }
		::highlight(vimode-find-current) { background-color: #fab387; color: #1e1b22; }
	`;
	// Highlights a range per match; past this many the page is not worth it.
	const FIND_LIMIT = 5000;
	let findQuery = "";
	let findMatches = [];
	let findIndex = -1;
	let findOrigin = null;
	let findStyle = null;
	let findFocused = null;

	// The page's visible text as one string, with where each text node starts
	// in it, so a match can span nodes ("foo<b>bar</b>").
	function pageText() {
		const nodes = [];
		let text = "";
		const visible = new Map();
		const root = document.body || document.documentElement;
		if (!root) return { nodes, text };
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const el = node.parentElement;
				if (!el || FIND_SKIP.has(el.tagName)) return NodeFilter.FILTER_REJECT;
				let v = visible.get(el);
				if (v === undefined) {
					v = el.checkVisibility({ visibilityProperty: true });
					visible.set(el, v);
				}
				return v ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
			},
		});
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			nodes.push({ node: n, start: text.length });
			text += n.data;
		}
		return { nodes, text };
	}

	function findAll(query) {
		if (!query) return [];
		const { nodes, text } = pageText();
		const exact = query !== query.toLowerCase();
		const hay = exact ? text : text.toLowerCase();
		const needle = exact ? query : query.toLowerCase();
		const ranges = [];
		let k = 0;
		for (let i = hay.indexOf(needle); i !== -1 && ranges.length < FIND_LIMIT; i = hay.indexOf(needle, i + needle.length)) {
			const end = i + needle.length;
			while (k + 1 < nodes.length && nodes[k + 1].start <= i) k++;
			let m = k;
			while (m + 1 < nodes.length && nodes[m + 1].start < end) m++;
			const r = document.createRange();
			r.setStart(nodes[k].node, i - nodes[k].start);
			r.setEnd(nodes[m].node, end - nodes[m].start);
			ranges.push(r);
		}
		return ranges;
	}

	function findStatus() {
		return findMatches.length ? `[${findIndex + 1}/${findMatches.length}]` : "";
	}

	function paintFind() {
		if (!findStyle) {
			findStyle = document.createElement("style");
			findStyle.textContent = FIND_CSS;
		}
		if (!findStyle.isConnected && document.documentElement) document.documentElement.append(findStyle);
		const current = new Highlight(...(findIndex >= 0 ? [findMatches[findIndex]] : []));
		current.priority = 1;
		CSS.highlights.set("vimode-find", new Highlight(...findMatches));
		CSS.highlights.set("vimode-find-current", current);
		render();
	}

	function clearFind() {
		findMatches = [];
		findIndex = -1;
		CSS.highlights.delete("vimode-find");
		CSS.highlights.delete("vimode-find-current");
		if (findStyle) findStyle.remove();
		unfocusFind();
		render();
	}

	// The link a match is in gets focus, as in Vimium, so Enter follows it;
	// the focus is taken back when the search moves on.
	function unfocusFind() {
		if (findFocused && document.activeElement === findFocused) findFocused.blur();
		findFocused = null;
	}

	function focusMatch() {
		unfocusFind();
		const r = findMatches[findIndex];
		const el = r && r.startContainer.parentElement;
		const link = el && el.closest("a[href], button, [role=link], [role=button]");
		if (link) {
			link.focus({ preventScroll: true });
			findFocused = link;
		}
	}

	function revealMatch() {
		const r = findMatches[findIndex];
		if (!r) return;
		const rect = r.getBoundingClientRect();
		// 20px is the bar.
		if (rect.top < 0 || rect.bottom > window.innerHeight - 20 || rect.left < 0 || rect.right > window.innerWidth) {
			r.startContainer.parentElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
		}
	}

	function openFind() {
		findOrigin = { x: window.scrollX, y: window.scrollY };
		clearFind();
		openPrompt("find");
	}

	// Incremental: each keystroke searches again from where the page was when
	// the prompt opened.
	function findType(query) {
		window.scrollTo({ left: findOrigin.x, top: findOrigin.y, behavior: "instant" });
		findMatches = findAll(query);
		findIndex = findMatches.findIndex((r) => r.getBoundingClientRect().top >= 0);
		if (findIndex === -1 && findMatches.length) findIndex = 0;
		revealMatch();
		paintFind();
	}

	function acceptFind() {
		const query = typed || findQuery;
		closeCommandLine();
		if (!query) return;
		findQuery = query;
		if (!typed) findType(query);
		if (!findMatches.length) {
			clearFind();
			flash(`Text not found: ${query}`);
			return;
		}
		focusMatch();
		render();
	}

	function cancelFind() {
		closeCommandLine();
		clearFind();
		if (findOrigin) window.scrollTo({ left: findOrigin.x, top: findOrigin.y, behavior: "instant" });
	}

	// n and N: the page may have changed since, so the search runs again and
	// picks up after the current match, or after the top of the screen when
	// that match is gone.
	function findNext(n, step) {
		if (!findQuery) {
			flash("No previous search");
			return;
		}
		const prev = findMatches[findIndex];
		findMatches = findAll(findQuery);
		if (!findMatches.length) {
			clearFind();
			flash(`Text not found: ${findQuery}`);
			return;
		}
		let i;
		if (prev && prev.startContainer.isConnected) {
			const after = (r) => r.compareBoundaryPoints(Range.START_TO_START, prev) > 0;
			const before = (r) => r.compareBoundaryPoints(Range.START_TO_START, prev) < 0;
			i = step > 0 ? findMatches.findIndex(after) : findMatches.findLastIndex(before);
		} else {
			i = step > 0
				? findMatches.findIndex((r) => r.getBoundingClientRect().top >= 0)
				: findMatches.findLastIndex((r) => r.getBoundingClientRect().bottom <= window.innerHeight - 20);
		}
		n -= 1;
		let wrapped = i === -1;
		if (i === -1) i = step > 0 ? 0 : findMatches.length - 1;
		for (; n > 0; n--) {
			const j = i + step;
			if (j < 0 || j >= findMatches.length) wrapped = true;
			i = (j + findMatches.length) % findMatches.length;
		}
		findIndex = i;
		revealMatch();
		paintFind();
		focusMatch();
		if (wrapped) flash(step > 0 ? "Search hit BOTTOM, continuing at TOP" : "Search hit TOP, continuing at BOTTOM");
	}

	findEscape = () => {
		if (!findMatches.length) return false;
		clearFind();
		return true;
	};

	// ---- the command line ---------------------------------------------------------
	//
	// qutebrowser's, cut down to commands: `:` (enterCommandMode) opens a
	// prompt in the bar with every command listed above it, the list narrows
	// as you type (each word must appear in a command's name or description,
	// matches in mauve), Tab and Shift-Tab (or the arrows, or Ctrl-N/Ctrl-P)
	// walk it and fill the prompt, Enter runs, Escape closes. The colours are
	// qutebrowser's completion ones from its config.py.
	//
	// The prompt is an input inside the bar's closed shadow root, so the page
	// sees keydowns bubbling out of it with the bar's host as their target.
	// Those are stopped at the window, before the page's own listeners can act
	// on them (a site's single-key shortcuts would otherwise fire as you
	// type); stopping propagation does not cancel the default action, so the
	// characters still land in the input.

	let commandOpen = false;
	// Which prompt is open: "command" (`:`) or "find" (`/`, see find mode).
	let promptKind = null;
	let selected = -1;
	let matches = [];
	// What was typed, as opposed to what Tab filled in: the list filters on
	// this, so walking it does not narrow it to the row just picked.
	let typed = "";

	function openPrompt(kind, value = "") {
		const b = bar();
		if (commandOpen) closeCommandLine();
		commandOpen = true;
		promptKind = kind;
		selected = -1;
		typed = value;
		b.input.value = value;
		b.promptPrefix.textContent = kind === "find" ? "/" : ":";
		render();
		renderCompletion();
		// Out of any iframe that had focus, or its keys would never reach the
		// prompt.
		leaveFrame();
		b.input.focus();
	}

	function openCommandLine() {
		openPrompt("command");
	}

	function closeCommandLine() {
		if (!commandOpen) return;
		commandOpen = false;
		promptKind = null;
		const b = bar();
		b.completion.classList.remove("open");
		if (b.input.matches(":focus")) b.input.blur();
		render();
	}

	// Each command's keys, as written in the config, for the list's right
	// column.
	function bindings() {
		const out = {};
		for (const [keys, command] of Object.entries(keymap)) {
			(out[command] = out[command] || []).push(keys.split(" ").join(""));
		}
		return out;
	}

	// A text node with every occurrence of the words wrapped in .match.
	function highlight(text, words) {
		const frag = document.createDocumentFragment();
		const lower = text.toLowerCase();
		const marks = new Array(text.length).fill(false);
		for (const w of words) {
			for (let i = lower.indexOf(w); w && i !== -1; i = lower.indexOf(w, i + 1)) {
				for (let j = i; j < i + w.length; j++) marks[j] = true;
			}
		}
		let i = 0;
		while (i < text.length) {
			let j = i;
			while (j < text.length && marks[j] === marks[i]) j++;
			const part = document.createTextNode(text.slice(i, j));
			if (marks[i]) {
				const span = document.createElement("span");
				span.className = "match";
				span.append(part);
				frag.append(span);
			} else {
				frag.append(part);
			}
			i = j;
		}
		return frag;
	}

	// ---- :open -------------------------------------------------------------
	//
	// qutebrowser's: `open <url or search>` in the command line, `open -t` for
	// a new tab. open and openInNewTab fill that in. While the line reads
	// "open ...", the list holds bookmarks and history matching the rest
	// (every word, in the URL or the title) instead of commands. Enter opens
	// the row picked, or else what was typed: an address goes straight
	// there, anything else to the browser's default search engine. Both
	// lists and the opening come from the background worker, which owns those
	// APIs.

	// "open -t foo bar" -> { newTab: true, text: "foo bar" }; null when the
	// line is not an open command.
	function openArgs(value) {
		const m = /^open\s(.*)$/s.exec(value);
		if (!m) return null;
		let text = m[1].trimStart();
		let newTab = false;
		if (text === "-t" || text.startsWith("-t ")) {
			newTab = true;
			text = text.slice(2).trimStart();
		}
		return { newTab, text };
	}

	let urlQuery = null;
	let urlResults = [];
	let deleting = false;

	// The browser address bar's inline completion: the rest of the address
	// you most likely mean ("yout" -> "youtube.com"), after the cursor and
	// selected, so typing on replaces it, Backspace drops it, and Right or End
	// keeps it. Enter opens the line as shown. Only while the line is still
	// exactly what was typed, with nothing picked from the list.
	function inlineComplete(completion) {
		const input = bar().input;
		if (!completion || deleting || selected !== -1 || input.value !== typed) return;
		if (input.selectionStart !== typed.length) return;
		const text = openArgs(typed).text;
		const stripped = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
		if (!stripped || !completion.toLowerCase().startsWith(stripped.toLowerCase())) return;
		input.value = typed + completion.slice(stripped.length);
		input.setSelectionRange(typed.length, input.value.length);
	}

	function renderUrlCompletion(args) {
		const b = bar();
		const query = args.text.trim();
		if (query !== urlQuery) {
			urlQuery = query;
			// Until the new results arrive, the old ones that still match stay
			// up, so the list narrows smoothly instead of emptying and
			// refilling on every key.
			const words = query.toLowerCase().split(/\s+/).filter(Boolean);
			urlResults = urlResults.filter((item) => words.every((w) => (item.url + " " + (item.title || "")).toLowerCase().includes(w)));
			chrome.runtime.sendMessage({ complete: query }).then((results) => {
				if (urlQuery !== query || !commandOpen || !results || !Array.isArray(results.items)) return;
				urlResults = results.items;
				renderCompletion();
				inlineComplete(results.inline);
			}).catch(() => {});
		}
		matches = urlResults;
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const list = b.completion;
		list.replaceChildren();
		list.classList.add("urls");
		let category = null;
		matches.forEach((item, i) => {
			if (item.category !== category) {
				category = item.category;
				const head = document.createElement("div");
				head.className = "category";
				head.textContent = category;
				list.append(head);
			}
			const row = document.createElement("div");
			row.className = "row" + (i === selected ? " selected" : "");
			const u = document.createElement("span");
			u.className = "name";
			u.append(highlight(item.url, words));
			const t = document.createElement("span");
			t.className = "desc";
			t.append(highlight(item.title || "", words));
			row.append(u, t);
			list.append(row);
		});
		list.classList.add("open");
		const row = list.querySelectorAll(".row")[selected];
		if (row) row.scrollIntoView({ block: "nearest" });
	}

	function renderCompletion() {
		const b = bar();
		const args = openArgs(typed);
		if (promptKind === "command" && args) {
			renderUrlCompletion(args);
			return;
		}
		urlQuery = null;
		b.completion.classList.remove("urls");
		const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
		matches = Object.entries(VIMODE_COMMANDS)
			.filter(([name]) => name !== "enterCommandMode")
			.filter(([name, { desc }]) => words.every((w) => (name + " " + desc).toLowerCase().includes(w)))
			.map(([name]) => name);
		const binds = bindings();
		const list = b.completion;
		list.replaceChildren();
		const category = document.createElement("div");
		category.className = "category";
		category.textContent = "Commands";
		list.append(category);
		matches.forEach((name, i) => {
			const row = document.createElement("div");
			row.className = "row" + (i === selected ? " selected" : "");
			const n = document.createElement("span");
			n.className = "name";
			n.append(highlight(name, words));
			const d = document.createElement("span");
			d.className = "desc";
			d.append(highlight(VIMODE_COMMANDS[name].desc, words));
			const k = document.createElement("span");
			k.className = "bind";
			k.textContent = (binds[name] || []).join(" ");
			row.append(n, d, k);
			list.append(row);
		});
		list.classList.toggle("open", promptKind === "command");
		const row = list.querySelectorAll(".row")[selected];
		if (row) row.scrollIntoView({ block: "nearest" });
	}

	function move(step) {
		if (!matches.length) return;
		selected = selected === -1
			? (step > 0 ? 0 : matches.length - 1)
			: (selected + step + matches.length) % matches.length;
		const args = openArgs(typed);
		bar().input.value = args
			? `open ${args.newTab ? "-t " : ""}${matches[selected].url}`
			: matches[selected];
		renderCompletion();
	}

	function accept() {
		const args = openArgs(bar().input.value);
		if (args) {
			const target = args.text.trim();
			// The picked row's title, kept with its count for the list.
			const picked = selected !== -1 && matches[selected] && matches[selected].url === target ? matches[selected].title : "";
			closeCommandLine();
			if (target) chrome.runtime.sendMessage({ open: target, newTab: args.newTab, title: picked || "" }).catch(() => {});
			return;
		}
		const typed = bar().input.value.trim();
		const name = typed in VIMODE_COMMANDS ? typed
			: selected !== -1 ? matches[selected]
			: matches.length === 1 ? matches[0]
			: null;
		closeCommandLine();
		if (name) run(name, 1);
		else if (typed) flash(`No command: ${typed}`);
	}

	commandKey = (e) => {
		if (!commandOpen || e.target !== host) return false;
		const t = token(e);
		const handlers = promptKind === "find" ? {
			"<esc>": cancelFind,
			"<enter>": acceptFind,
		} : {
			"<esc>": closeCommandLine,
			"<enter>": accept,
			"<tab>": () => move(1),
			"<s-tab>": () => move(-1),
			"<down>": () => move(1),
			"<up>": () => move(-1),
			"<c-n>": () => move(1),
			"<c-p>": () => move(-1),
		};
		if (t in handlers) {
			swallow(e);
			// See returnFocus.
			closingKeys.add(e.code);
			handlers[t]();
		} else {
			e.stopImmediatePropagation();
		}
		return true;
	};
	// The prompt and the help screen read keys here, in the top frame, so
	// they take focus out of any iframe that had it (Google Docs' editor
	// frame). Closing one with a key gives that focus back, once the key is
	// released: its keyup must not reach the page (Docs refocuses its editor
	// on one, which is insert mode), and without the focus back, keys typed
	// after `i` would never reach Docs.
	let returnFocus = null;
	const closingKeys = new Set();

	function leaveFrame() {
		const el = document.activeElement;
		if (el && el.tagName === "IFRAME") {
			returnFocus = el;
			el.blur();
		}
	}

	function restoreFocus() {
		const el = returnFocus;
		returnFocus = null;
		const active = document.activeElement;
		// Only if nothing has taken focus since (a field, a found link).
		if (el && el.isConnected && (!active || active === document.body)) el.focus({ preventScroll: true });
	}

	for (const type of ["keypress", "keyup"]) {
		window.addEventListener(type, (e) => {
			if (type === "keyup" && closingKeys.delete(e.code)) {
				swallow(e);
				restoreFocus();
			} else if (commandOpen && e.target === host) {
				e.stopImmediatePropagation();
			}
		}, true);
	}
})();
