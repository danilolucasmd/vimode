// The background worker: reads the config through the native host, and runs
// the commands that need the tabs API.
importScripts("commands.js");

const DEFAULT_CONFIG_PATH = "~/dotfiles/vimode/vimoderc";

// ---- config ---------------------------------------------------------------
//
// An extension cannot read a file outside its own directory, and an unpacked
// extension's directory cannot hold a symlink that leads out of it, so the
// config comes through a native messaging host (host/vimode_host.py). The
// host watches the file and sends its text on every change, so an edit to the
// dotfile reaches every open tab within a second. The open port is also what
// keeps this worker alive: Chrome does not suspend a worker holding one.

let port = null;

async function configPath() {
	const { configPath } = await chrome.storage.local.get("configPath");
	return configPath || DEFAULT_CONFIG_PATH;
}

async function setStatus(status) {
	await chrome.storage.local.set({ status: { ...status, at: Date.now() } });
}

async function connect() {
	port = chrome.runtime.connectNative("vimode");
	port.onMessage.addListener(async (msg) => {
		if (typeof msg.text === "string") {
			const parsed = vimodeParse(msg.text);
			await chrome.storage.local.set({ config: { keymap: parsed.keymap, settings: parsed.settings } });
			await setStatus({ ok: true, path: msg.path, errors: parsed.errors });
		} else if (msg.error) {
			await setStatus({ ok: false, path: msg.path, errors: [msg.error] });
		}
	});
	port.onDisconnect.addListener(async () => {
		const why = chrome.runtime.lastError ? chrome.runtime.lastError.message : "host exited";
		port = null;
		await setStatus({ ok: false, errors: [`native host: ${why}. Run host/install.sh in the vimode repo.`] });
		// The defaults keep working meanwhile; retry in case the host was only
		// just installed.
		setTimeout(connect, 10000);
	});
	port.postMessage({ path: await configPath() });
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && "configPath" in changes && port) {
		configPath().then((path) => port.postMessage({ path }));
	}
});

connect();

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

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (msg && msg.tabCommand in tabCommands && sender.tab) {
		tabCommands[msg.tabCommand](sender.tab, Math.max(1, msg.count | 0)).catch(() => {});
	}
});
