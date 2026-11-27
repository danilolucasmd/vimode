# vimode

Vim-style keyboard navigation for Chromium browsers, configured from a live-reloaded dotfile, with a qutebrowser-style status bar.

vimode gives a browser a normal mode and an insert mode, like Vimium, and keeps its keymap in a plain text file instead of the extension's settings. Edit the file and every open tab picks up the change within a second, so the keymap can live in your dotfiles and follow you from machine to machine.

## Features

- **Modes that work like Vimium's.** Normal mode runs the keymap. Focusing a text field, or pressing the key mapped to `enterInsertMode`, switches to insert mode, where every key goes to the page. Escape leaves insert mode, and leaving a focused field blurs it. Keys the keymap does not use still reach the page in normal mode, so a site's own shortcuts keep working.
- **A status bar.** A full-width strip along the bottom of every page: grey in normal mode, green with `-- INSERT --` in insert mode. The page's URL sits on the right (green for https), replaced by a hovered link's URL in blue, followed by any half-typed key sequence such as `2gb`. Clicks pass through the bar, and it hides in fullscreen.
- **A live config file.** Saving the file applies it everywhere at once. A line with a mistake is skipped and reported on the options page, and the rest of the file still loads.
- **Works in every frame,** including Google Docs, whose editor types into a hidden iframe.
- **Counts,** as in Vim: `3j` scrolls three steps, `2bd` closes two tabs.

Link hints are not implemented yet.

## Install

vimode is loaded unpacked, and it needs a small native messaging host to read its config file.

1. Clone the repo:

   ```sh
   git clone https://github.com/danilolucasmd/vimode.git ~/Code/vimode
   ```

2. Register the native host:

   ```sh
   ~/Code/vimode/host/install.sh
   ```

   This writes a `vimode.json` host manifest for each Chromium-family browser it finds in `~/.config` (Brave, Chromium, Google Chrome), pointing at `host/vimode_host.py`. It needs Python 3 and nothing else. Re-run it if you move the repo.

3. Open `brave://extensions` (or `chrome://extensions`), turn on Developer mode, click "Load unpacked" and choose the repo directory.

4. Create your config file (see below) and, if it is not at the default path, set its path on vimode's options page.

The browser loads the extension straight from the repo directory, so after changing the code, press the reload button on vimode's card and reload open tabs.

## Configuration

The default config path is `~/dotfiles/vimode/vimoderc`. Change it on the options page (right-click the extension icon, then Options). The page also shows when the file was last loaded and any lines that were skipped.

The file is the whole keymap: nothing is built in, so a key does something only if a line maps it. The syntax follows Vimium's:

```
# Comments start with # or "
set grabBackFocus true

map j scrollDown
map k scrollUp
map gg scrollToTop
map G scrollToBottom
map <c-d> scrollPageDown
map i enterInsertMode
map L nextTab
map H previousTab
map bd removeTab
```

- `map <keys> <command>` binds a key or sequence. Keys are typed as written (`gg`, `G`, `$`); special keys and modifiers go in angle brackets: `<c-o>` (Ctrl), `<a-p>` (Alt), `<m-x>` (Meta), `<s-left>` (Shift, for named keys only, since shifted characters are written as themselves), and named keys such as `<space>`, `<enter>`, `<tab>`, `<backspace>`, `<left>`, `<f1>`.
- `set <name> <value>` changes a setting.

### Settings

| Setting | Default | What it does |
|---|---|---|
| `scrollStepSize` | `60` | Pixels moved by `scrollDown`, `scrollUp`, `scrollLeft` and `scrollRight`. |
| `grabBackFocus` | `false` | Undo a text field focusing itself as the page loads, until you press a key or click. Without it, a page that autofocuses a search box starts in insert mode. |

### Commands

Most commands take a count, typed before the key. For `focusInput` the count picks the nth field; for the others it repeats the command.

**Modes**

| Command | What it does |
|---|---|
| `enterInsertMode` | Insert mode until Escape. |
| `focusInput` | Focus the first visible text field (or the nth, with a count). |

**Scrolling**

| Command | What it does |
|---|---|
| `scrollDown`, `scrollUp`, `scrollLeft`, `scrollRight` | One step (`scrollStepSize`). |
| `scrollPageDown`, `scrollPageUp` | Half a page. |
| `scrollFullPageDown`, `scrollFullPageUp` | A full page. |
| `scrollToTop`, `scrollToBottom`, `scrollToLeft`, `scrollToRight` | To the edge. |

**History and the address**

| Command | What it does |
|---|---|
| `goBack`, `goForward` | Browser history. |
| `goUp` | Drop the last segment of the URL path. |
| `goToRoot` | Go to the site's root. |
| `reload` | Reload the page. |
| `copyCurrentUrl` | Copy the page's URL. |

**Tabs**

| Command | What it does |
|---|---|
| `nextTab`, `previousTab` | Switch tabs, wrapping around at the ends. |
| `firstTab`, `lastTab` | Jump to the first or last tab. |
| `visitPreviousTab` | Return to the tab you were on before this one. |
| `createTab` | Open a new tab next to this one. |
| `duplicateTab` | Duplicate this tab. |
| `removeTab` | Close this tab. |
| `restoreTab` | Reopen the last closed tab. |
| `togglePinTab` | Pin or unpin this tab. |
| `closeOtherTabs`, `closeTabsOnLeft`, `closeTabsOnRight` | Close tabs in bulk. Pinned tabs are kept. |
| `moveTabLeft`, `moveTabRight` | Move this tab. |

## How it works

An extension cannot read files outside its own directory, and an unpacked extension cannot follow a symlink out of it. So the background worker opens a native messaging connection to `host/vimode_host.py`, which watches the config file and sends its contents whenever it changes. The worker parses the file and stores the result in extension storage, where every tab's content script picks it up. The open connection also keeps the worker alive.

The extension's ID is fixed by the `key` in `manifest.json`, so it is the same on every machine and from any directory. That lets `host/install.sh` hardcode it in the host manifest's `allowed_origins`, so only vimode can talk to the host.

Keys are handled by a content script in every frame. The status bar is drawn by the top frame, and other frames report their mode to it.

## Limitations

- Browsers keep extensions off their own pages (`chrome://` and `brave://` pages, the new tab page, the Web Store), so vimode does nothing there.
- Scrolling moves the page itself. A site that scrolls an inner panel instead of the page does not respond to the scroll commands yet.
- The status bar overlays the bottom 20px of the page, since an extension cannot resize the viewport.
- `web.whatsapp.com` is excluded in `manifest.json`, since a page that is all typing has no use for normal mode. Edit `exclude_matches` to change that.
- No link hints yet.
