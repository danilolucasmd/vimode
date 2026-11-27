// The background worker: runs the commands that need the tabs API, and
// coordinates link hints across frames. The config is imported on the options
// page and read from extension storage by whoever needs it.
importScripts("commands.js");

// The options page's reload button asks for the page back once the reloaded
// extension is running again.
chrome.storage.local.get("reopenOptions").then(({ reopenOptions }) => {
	if (reopenOptions) {
		chrome.storage.local.remove("reopenOptions");
		chrome.runtime.openOptionsPage();
	}
});

// ---- tab commands ---------------------------------------------------------

// The tab each window showed before the current one, for visitPreviousTab.
const previousTab = new Map();
const currentTab = new Map();
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
	if (currentTab.has(windowId) && currentTab.get(windowId) !== tabId) {
		previousTab.set(windowId, currentTab.get(windowId));
	}
	currentTab.set(windowId, tabId);
});

const windowTabs = (tab) => chrome.tabs.query({ windowId: tab.windowId });
const activate = (id) => chrome.tabs.update(id, { active: true });

const tabCommands = {
	async nextTab(tab, count) {
		const tabs = await windowTabs(tab);
		await activate(tabs[(tab.index + count) % tabs.length].id);
	},
	async previousTab(tab, count) {
		const tabs = await windowTabs(tab);
		const i = ((tab.index - count) % tabs.length + tabs.length) % tabs.length;
		await activate(tabs[i].id);
	},
	async firstTab(tab) {
		await activate((await windowTabs(tab))[0].id);
	},
	async lastTab(tab) {
		const tabs = await windowTabs(tab);
		await activate(tabs[tabs.length - 1].id);
	},
	async visitPreviousTab(tab) {
		const id = previousTab.get(tab.windowId);
		if (id !== undefined) await activate(id).catch(() => {});
	},
	async createTab(tab, count) {
		for (let i = 0; i < count; i++) {
			await chrome.tabs.create({ windowId: tab.windowId, index: tab.index + 1 + i });
		}
	},
	async duplicateTab(tab, count) {
		for (let i = 0; i < count; i++) await chrome.tabs.duplicate(tab.id);
	},
	async removeTab(tab, count) {
		const tabs = await windowTabs(tab);
		await chrome.tabs.remove(tabs.slice(tab.index, tab.index + count).map((t) => t.id));
	},
	async restoreTab(tab, count) {
		for (let i = 0; i < count; i++) await chrome.sessions.restore();
	},
	async togglePinTab(tab) {
		await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
	},
	// Pinned tabs survive the bulk closes, as in Vimium.
	async closeOtherTabs(tab) {
		const tabs = await windowTabs(tab);
		await chrome.tabs.remove(tabs.filter((t) => t.id !== tab.id && !t.pinned).map((t) => t.id));
	},
	async closeTabsOnLeft(tab) {
		const tabs = await windowTabs(tab);
		await chrome.tabs.remove(tabs.filter((t) => t.index < tab.index && !t.pinned).map((t) => t.id));
	},
	async closeTabsOnRight(tab) {
		const tabs = await windowTabs(tab);
		await chrome.tabs.remove(tabs.filter((t) => t.index > tab.index && !t.pinned).map((t) => t.id));
	},
	async moveTabLeft(tab, count) {
		await chrome.tabs.move(tab.id, { index: Math.max(0, tab.index - count) });
	},
	async moveTabRight(tab, count) {
		await chrome.tabs.move(tab.id, { index: tab.index + count });
	},
};

// ---- link hints -------------------------------------------------------------
//
// Hints span every frame of the tab, and a hint string must be unique across
// all of them, so this worker coordinates them as Vimium's does: it asks each
// frame how many elements it would hint, deals out one set of hint strings,
// and from then on receives the typed keys (from whichever frame has focus)
// and tells every frame what to show, and the one frame that owns the match
// what to activate.

// Vimium's AlphabetHints.hintStrings: a breadth-first fill of strings over the
// hint characters, so no hint is a prefix of another and the short ones are
// used first, then sorted and reversed so that hints sharing a first
// character are spread across the page rather than clustered.
function hintStrings(count, chars) {
	if (count <= 0) return [];
	let hints = [""];
	let offset = 0;
	while (hints.length - offset < count || hints.length === 1) {
		const hint = hints[offset++];
		for (const ch of chars) hints.push(ch + hint);
	}
	return hints.slice(offset, offset + count).sort().map((h) => [...h].reverse().join(""));
}

// tabId -> { mode, typed, shift, hints: [{ frameId, index, hint }] }
const hintSessions = new Map();

const toFrame = (tabId, frameId, msg) =>
	chrome.tabs.sendMessage(tabId, { vimodeHints: msg }, { frameId }).catch(() => null);

async function allFrames(tabId) {
	const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
	return frames ? frames.map((f) => f.frameId) : [0];
}

async function broadcast(tabId, msg) {
	await Promise.all((await allFrames(tabId)).map((id) => toFrame(tabId, id, msg)));
}

async function startHints(tab, mode) {
	const { config } = await chrome.storage.local.get("config");
	const chars = (config && config.settings && config.settings.linkHintCharacters)
		|| VIMODE_DEFAULT_SETTINGS.linkHintCharacters;
	const frameIds = await allFrames(tab.id);
	const counts = await Promise.all(frameIds.map((id) => toFrame(tab.id, id, { op: "collect" })));
	const total = counts.reduce((n, c) => n + ((c && c.count) || 0), 0);
	if (!total) {
		await toFrame(tab.id, 0, { op: "flash", text: "No links to hint" });
		return;
	}
	const strings = hintStrings(total, chars);
	const hints = [];
	let next = 0;
	frameIds.forEach((frameId, i) => {
		const n = (counts[i] && counts[i].count) || 0;
		for (let index = 0; index < n; index++) hints.push({ frameId, index, hint: strings[next++] });
	});
	hintSessions.set(tab.id, { mode, typed: "", shift: false, hints });
	await Promise.all(frameIds.map((frameId) => toFrame(tab.id, frameId, {
		op: "show",
		hints: hints.filter((h) => h.frameId === frameId).map((h) => h.hint),
	})));
}

async function exitHints(tabId) {
	hintSessions.delete(tabId);
	await broadcast(tabId, { op: "exit" });
}

// Holding Shift swaps opening in this tab and in a new one, as in Vimium.
function effectiveMode(session) {
	if (!session.shift) return session.mode;
	return { click: "newTab", newTab: "click", newForegroundTab: "click" }[session.mode] || session.mode;
}

async function hintKey(tab, key) {
	const session = hintSessions.get(tab.id);
	if (!session) return;
	if (key === "Escape") return exitHints(tab.id);
	if (key === "ShiftDown" || key === "ShiftUp") {
		session.shift = key === "ShiftDown";
		return;
	}
	if (key === "Space") return broadcast(tab.id, { op: "rotate" });
	if (key === "Backspace") {
		session.typed = session.typed.slice(0, -1);
	} else {
		const typed = session.typed + key.toLowerCase();
		// A key that matches no hint is ignored, as in Vimium.
		if (!session.hints.some((h) => h.hint.startsWith(typed))) return;
		session.typed = typed;
	}
	const match = session.hints.find((h) => h.hint === session.typed);
	if (!match) return broadcast(tab.id, { op: "filter", typed: session.typed });
	const mode = effectiveMode(session);
	await toFrame(tab.id, match.frameId, { op: "activate", index: match.index, mode });
	if (session.mode === "queue") {
		// Vimium's queue mode re-hints the page after every pick.
		await broadcast(tab.id, { op: "exit" });
		await startHints(tab, "queue");
	} else {
		await exitHints(tab.id);
	}
}

chrome.tabs.onRemoved.addListener((tabId) => hintSessions.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (!msg || !sender.tab) return;
	if (msg.tabCommand in tabCommands) {
		tabCommands[msg.tabCommand](sender.tab, Math.max(1, msg.count | 0)).catch(() => {});
	} else if (msg.hintsStart in VIMODE_HINT_MODES) {
		startHints(sender.tab, VIMODE_HINT_MODES[msg.hintsStart]).catch(() => {});
	} else if (typeof msg.hintsKey === "string") {
		hintKey(sender.tab, msg.hintsKey).catch(() => {});
	} else if (typeof msg.openUrl === "string") {
		chrome.tabs.create({ url: msg.openUrl, active: !!msg.active, openerTabId: sender.tab.id }).catch(() => {});
	}
});
