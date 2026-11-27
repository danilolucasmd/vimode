// The background worker: runs the commands that need the tabs or runtime
// APIs, and coordinates link hints across frames. The config is imported by
// the content script (importConfig) and read from extension storage.
importScripts("commands.js");

// reloadExtension leaves the tab it was run from with a content script cut
// off from the new extension, so the tab is reloaded once the new worker
// starts.
chrome.storage.local.get("reloadTab").then(({ reloadTab }) => {
	if (typeof reloadTab === "number") {
		chrome.storage.local.remove("reloadTab");
		chrome.tabs.reload(reloadTab).catch(() => {});
	}
});

// The bundled keymap (defaults/vimoderc), stored on a fresh install so the
// keys work at once, and by importDefaults. An imported style.css is kept.
async function importDefaults() {
	const text = await (await fetch(chrome.runtime.getURL("defaults/vimoderc"))).text();
	const { source = {} } = await chrome.storage.local.get("source");
	source.keymap = { name: "defaults", text };
	await vimodeSaveConfig(source);
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
	if (reason === "install") importDefaults().catch(() => {});
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
	async reloadExtension(tab) {
		await chrome.storage.local.set({ reloadTab: tab.id });
		chrome.runtime.reload();
	},
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

// ---- :open ------------------------------------------------------------------

// The list and the inline completion for what was typed after "open".
async function complete(query) {
	const { openCounts = {} } = await chrome.storage.local.get("openCounts");
	const [items, inline] = await Promise.all([completeList(query, openCounts), completeInline(query, openCounts)]);
	return { items, inline };
}

// Every address opened through :open, typed or picked from the list, with
// how many times, when last, and its title when known. This is the ranking:
// what you open most comes first, whatever the browser's history says.
// History only stands in for addresses never opened here.
const OPEN_COUNTS_MAX = 2000;
const countKey = (url) => url.replace(/\/$/, "");
const bare = (url) => url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
const byUse = (a, b) => b.count - a.count || b.at - a.at;

async function countOpen(url, title) {
	const { openCounts = {} } = await chrome.storage.local.get("openCounts");
	const key = countKey(url);
	const entry = openCounts[key] || { count: 0 };
	entry.count += 1;
	entry.at = Date.now();
	if (title) entry.title = title;
	openCounts[key] = entry;
	const keys = Object.keys(openCounts);
	if (keys.length > OPEN_COUNTS_MAX) {
		// The least used, and of those the longest unused, make room.
		keys.sort((x, y) => byUse(openCounts[y], openCounts[x]));
		for (const old of keys.slice(0, keys.length - OPEN_COUNTS_MAX)) delete openCounts[old];
	}
	await chrome.storage.local.set({ openCounts });
}

// The address to complete inline, scheme and www. left off: the most opened
// one that starts with what was typed. Failing that, from history: of the
// entries whose host starts with it (or whose address does, once a / is
// typed), the one with the most visits summed. Nothing when what was typed
// is already the best match, or is a search (anything with a space).
async function completeInline(query, openCounts) {
	const typed = bare(query.trim()).toLowerCase();
	if (!typed || /\s/.test(typed)) return null;
	let best = null;
	for (const [key, entry] of Object.entries(openCounts)) {
		const address = bare(key);
		if (address.toLowerCase().startsWith(typed) && (!best || byUse(entry, best.entry) < 0)) best = { address, entry };
	}
	if (best) return best.address.length > typed.length ? best.address : null;
	// History's text search matches words, not paths, so it is asked for the
	// host part and the rest is matched here.
	const visits = await historyFor(typed.split("/")[0]);
	const scores = new Map();
	for (const h of visits) {
		const address = bare(h.url);
		const candidate = typed.includes("/") ? countKey(address) : address.split(/[/?#]/)[0];
		if (!candidate.toLowerCase().startsWith(typed)) continue;
		scores.set(candidate, (scores.get(candidate) || 0) + (h.visitCount || 0));
	}
	let top = null;
	for (const [candidate, score] of scores) {
		if (!top || score > top[1]) top = [candidate, score];
	}
	return top && top[0].length > typed.length ? top[0] : null;
}

// History's own text search matches whole words ("yo" misses "youtube"), so
// it is joined by the most recent entries, matched here by substring like
// everything else. Those are read once and reused for a few seconds, since
// a query arrives on every key.
let recentHistory = null;
let recentHistoryAt = 0;
async function historyFor(query) {
	if (!recentHistory || Date.now() - recentHistoryAt > 10000) {
		recentHistory = await chrome.history.search({ text: "", startTime: 0, maxResults: 3000 });
		recentHistoryAt = Date.now();
	}
	if (!query) return recentHistory;
	const byText = await chrome.history.search({ text: query, startTime: 0, maxResults: 500 });
	const urls = new Set(byText.map((h) => h.url));
	return [...byText, ...recentHistory.filter((h) => !urls.has(h.url))];
}

// The list: what you opened most, then bookmarks, then history by visits,
// each keeping only entries with every word somewhere in the URL or title.
// An address shows once, under the first of those it is in.
async function completeList(query, openCounts) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	const fits = (item) => item.url && words.every((w) => (item.url + " " + (item.title || "")).toLowerCase().includes(w));
	const seen = new Set();
	const out = [];
	const add = (category, url, title) => {
		const key = countKey(url);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ category, url, title });
	};
	const marks = query ? await chrome.bookmarks.search(query) : await chrome.bookmarks.getRecent(10);
	const visits = await historyFor(query);
	// A typed address was counted without a title; the browser knows it.
	const titles = new Map([...visits, ...marks].filter((x) => x.url && x.title).map((x) => [countKey(x.url), x.title]));
	const used = Object.entries(openCounts)
		.map(([url, entry]) => ({ url, ...entry, title: entry.title || titles.get(url) }))
		.filter(fits)
		.sort(byUse);
	for (const u of used.slice(0, 20)) add("Most used", u.url, u.title);
	for (const m of marks.filter(fits).slice(0, 20)) add("Bookmarks", m.url, m.title);
	visits.sort((x, y) => (y.visitCount || 0) - (x.visitCount || 0));
	for (const h of visits.filter(fits)) {
		add("History", h.url, h.title);
		if (out.length >= 100) break;
	}
	return out;
}

// What was typed in :open, as an address when it looks like one: a scheme,
// localhost or an IP, or a dotted host with no spaces. Anything else is a
// search.
function toUrl(text) {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|data|file):/i.test(text)) return text;
	if (/\s/.test(text)) return null;
	if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i.test(text)) return "http://" + text;
	if (/^[^\s/?#]+\.[a-z][a-z0-9-]+\.?(:\d+)?([/?#].*)?$/i.test(text)) return "https://" + text;
	return null;
}

async function open(tab, text, newTab, title) {
	const url = toUrl(text);
	if (url) {
		await countOpen(url, title);
		if (newTab) await chrome.tabs.create({ url, index: tab.index + 1, openerTabId: tab.id });
		else await chrome.tabs.update(tab.id, { url });
	} else {
		// The browser's own default search engine.
		await chrome.search.query(newTab ? { text, disposition: "NEW_TAB" } : { text, tabId: tab.id });
	}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (!msg || !sender.tab) return;
	if (msg.tabCommand in tabCommands) {
		tabCommands[msg.tabCommand](sender.tab, Math.max(1, msg.count | 0)).catch(() => {});
	} else if (msg.hintsStart in VIMODE_HINT_MODES) {
		startHints(sender.tab, VIMODE_HINT_MODES[msg.hintsStart]).catch(() => {});
	} else if (typeof msg.hintsKey === "string") {
		hintKey(sender.tab, msg.hintsKey).catch(() => {});
	} else if (typeof msg.complete === "string") {
		complete(msg.complete).then(sendResponse, () => sendResponse([]));
		return true;
	} else if (typeof msg.open === "string") {
		open(sender.tab, msg.open, !!msg.newTab, typeof msg.title === "string" ? msg.title : "").catch(() => {});
	} else if (msg.importDefaults) {
		// Answered once stored, so the page can say whether it worked.
		importDefaults().then(() => sendResponse(true), () => sendResponse(false));
		return true;
	} else if (typeof msg.openUrl === "string") {
		chrome.tabs.create({ url: msg.openUrl, active: !!msg.active, openerTabId: sender.tab.id }).catch(() => {});
	}
});
