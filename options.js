// The options page: imports the config files into extension storage, as
// Vimium's backup import does. The raw texts are kept next to the parsed
// config, so importing only one of the two files keeps the other.

const files = document.getElementById("files");
const status = document.getElementById("status");

document.getElementById("import").addEventListener("click", () => files.click());

files.addEventListener("change", async () => {
	const { source = {} } = await chrome.storage.local.get("source");
	const imported = [];
	for (const file of files.files) {
		const text = await file.text();
		if (file.name.toLowerCase().endsWith(".css")) source.css = { name: file.name, text };
		else source.keymap = { name: file.name, text };
		imported.push(file.name);
	}
	files.value = "";
	const parsed = vimodeParse(source.keymap ? source.keymap.text : "");
	await chrome.storage.local.set({
		source,
		config: {
			keymap: parsed.keymap,
			settings: parsed.settings,
			css: source.css ? source.css.text : "",
		},
		status: { at: Date.now(), imported, errors: parsed.errors },
	});
	show();
});

async function show() {
	const { source = {}, status: s } = await chrome.storage.local.get(["source", "status"]);
	if (!s || !s.imported) {
		status.className = "bad";
		status.textContent = "Nothing imported yet.";
		return;
	}
	const lines = [
		`Imported ${s.imported.join(", ")} at ${new Date(s.at).toLocaleString()}`,
		`Keymap: ${source.keymap ? source.keymap.name : "none"}   Styles: ${source.css ? source.css.name : "none"}`,
		...s.errors.map((e) => `Skipped ${e}`),
	];
	status.className = s.errors.length ? "bad" : "ok";
	status.textContent = lines.join("\n");
}

show();
