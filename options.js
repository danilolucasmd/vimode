const DEFAULT_CONFIG_PATH = "~/dotfiles/vimode/vimoderc";
const path = document.getElementById("path");
const status = document.getElementById("status");

chrome.storage.local.get(["configPath", "status"]).then((s) => {
	path.value = s.configPath || DEFAULT_CONFIG_PATH;
	show(s.status);
});

path.addEventListener("input", () => {
	chrome.storage.local.set({ configPath: path.value.trim() || DEFAULT_CONFIG_PATH });
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && changes.status) show(changes.status.newValue);
});

function show(s) {
	if (!s) {
		status.textContent = "Waiting for the native host...";
		return;
	}
	const when = new Date(s.at).toLocaleTimeString();
	const lines = [s.ok ? `Loaded ${s.path} at ${when}` : `Not loaded (${when})`, ...(s.errors || [])];
	status.className = s.ok && !(s.errors || []).length ? "ok" : "bad";
	status.textContent = lines.join("\n");
}
