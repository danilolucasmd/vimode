<img src="icons/icon-128.png" width="96" alt="Vimode logo">

# Vimode

Vim-style keyboard navigation for Chromium browsers, configured from a dotfile, with a qutebrowser-style status bar.

Vimode gives a browser a normal mode and an insert mode, like Vimium, and takes its keymap from a plain text file instead of a settings form, so the keymap can live in your dotfiles and follow you from machine to machine. Import the file with the `importConfig` command, and again after each change.

## Features

- **Modes that work like Vimium's.** Normal mode runs the keymap. Focusing a text field, or pressing the key mapped to `enterInsertMode`, switches to insert mode, where every key goes to the page. Escape leaves insert mode, and leaving a focused field blurs it. Keys the keymap does not use still reach the page in normal mode, so a site's own shortcuts keep working.
- **A status bar.** A full-width strip along the bottom of every page: grey in normal mode, green with `-- INSERT --` in insert mode, and `-- HINT --` while link hints are up. The page's URL sits on the right (green for https), replaced by a hovered link's URL in blue, followed by any half-typed key sequence such as `2gb`. Clicks pass through the bar, and it hides in fullscreen.
- **A config file.** Importing it applies it to every open tab at once. A line with a mistake is skipped and listed, and the rest of the file still loads.
- **Works in every frame,** including Google Docs, whose editor types into a hidden iframe.
- **A help screen,** like Vimium's. The key mapped to `showHelp` (`?` is the natural choice) shows every mapped key, grouped, with what it does. Escape closes it.
- **A key hint,** like qutebrowser's. Pause halfway through a key sequence (after `g`, say) and a panel above the status bar lists every mapping that continues it, with its command.
- **A command line,** like qutebrowser's. The key mapped to `enterCommandMode` (`:` is the natural choice) opens a prompt in the status bar with every command listed above it, alongside its description and keys. The list narrows as you type, matching each word against the name and description. Tab and Shift-Tab (or the arrows, or Ctrl-N and Ctrl-P) walk the list, Ctrl-D and Ctrl-U move half a page, Enter runs the command, and Escape closes the prompt. Keys typed into it never reach the page.
- **Find mode.** The key mapped to `enterFindMode` (`/` is the natural choice) opens a search prompt in the status bar. Every match on the page is highlighted as you type, the current one in orange and scrolled into view, with its position (`[3/17]`) on the right. Enter keeps the search and focuses the match's link, if it is in one, so a second Enter follows it; Escape puts the page back where it was. `performFind` and `performBackwardsFind` step through the matches, wrapping at the ends, and Escape in normal mode clears the highlights. A lowercase search ignores case; any capital letter makes it exact.
- **Open a URL or search,** like qutebrowser's `:open`. The keys mapped to `open` and `openInNewTab` (`o` and `O` in the defaults) fill the command line with `open ` or `open -t `, and the list above it shows your bookmarks and history, narrowing to entries with every typed word in the URL or title. Tab picks one, Enter opens it. As in the browser's address bar, typing the start of an address completes it inline with your most used match (`yout` becomes `youtube.com`, the added part selected): keep typing to replace it, Backspace to drop it, Right or End to keep it. "Most used" is Vimode's own count: every address opened through `open`, typed or picked from the list, gets one more, and the most opened comes first, inline and at the top of the list. Addresses never opened that way fall back to their visit count in the browser's history. The counts stay in extension storage, on this browser only. Typed text that looks like an address (a scheme, `localhost`, an IP, or a dotted host) is opened directly; anything else goes to the browser's default search engine. With this and the status bar showing the URL, the browser's address bar can be hidden.
- **Counts,** as in Vim: `3j` scrolls three steps, `2bd` closes two tabs.

- **Link hints,** as in Vimium. A hint command labels every clickable thing on screen, in every frame, and typing a label picks it: click it, open it in a background or foreground tab, open several in a row, copy its address, or download it. Labels narrow as you type; Backspace undoes a character, Escape or a click cancels, holding Shift swaps opening in this tab and in a new one, and Space cycles labels that overlap.

## Install

Vimode is loaded unpacked:

1. Clone the repo:

   ```sh
   git clone https://github.com/danilolucasmd/vimode.git ~/Code/vimode
   ```

2. Open `brave://extensions` (or `chrome://extensions`), turn on Developer mode, click "Load unpacked" and choose the repo directory.

3. That is all: a fresh install loads the default keymap, [`defaults/vimoderc`](defaults/vimoderc), so the keys work at once (press `?` to see them). To use your own, run `:exportConfig` to download it as `vimoderc`, edit it, and on any web page type `:importConfig` and Enter, then pick it (see below). `:importDefaults` goes back to the defaults.

The browser loads the extension straight from the repo directory, so after changing the code, run `:reloadExtension` (or press the reload button on Vimode's card). It reloads the tab it was run from; reload any other open tabs yourself.

## Configuration

The config is one or two files, imported with `importConfig`, which opens a file picker: the keymap (any name, `vimoderc` by convention) and an optional `style.css`. Pick one or both at once; a file ending in `.css` is taken as the styles and anything else as the keymap, and a file not picked keeps what was imported before. Vimode keeps a copy, so import again after editing. The status bar confirms what was imported, and any lines that were skipped are listed in a panel. A file that is not text (a zip, an image), is over 256 KB, or is a keymap that maps no keys is refused, and the current config stays. Whatever the config, if no key opens the command line, `:` does, so `:importConfig` and `:importDefaults` are always reachable.

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
| `keyhintDelay` | `500` | Milliseconds a half-typed key sequence waits before the key hint panel appears. Negative turns it off. |
| `linkHintCharacters` | `sadfjklewcmpgh` | The characters link hints are made of. Shown in capitals. |
| `passUnmappedKeys` | `true` | Whether a printable key with no mapping reaches the page in normal mode. Set it to `false` to drop such keys, as qutebrowser does; keys with Ctrl, Alt or Meta, and named keys like the arrows, space and Enter, still pass. Google Docs needs `false`: it takes any typed character as editing and switches to insert mode. |

### Commands

Most commands take a count, typed before the key. For `focusInput` the count picks the nth field; for the others it repeats the command.

**Modes**

| Command | What it does |
|---|---|
| `enterInsertMode` | Insert mode until Escape. |
| `enterCommandMode` | Open the command line. |
| `showHelp` | Show every mapped key, grouped, with what it does. Escape or the same key closes it. |
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
| `open`, `openInNewTab` | Open a URL or search, here or in a new tab, picking from bookmarks and history. |
| `editUrl` | `open` with this page's URL filled in and selected, as the address bar's Ctrl+L: type to replace it, or Right to edit it. |
| `goBack`, `goForward` | Browser history. |
| `goUp` | Drop the last segment of the URL path. |
| `goToRoot` | Go to the site's root. |
| `reload` | Reload the page. |
| `copyCurrentUrl` | Copy the page's URL. |

**Find**

| Command | What it does |
|---|---|
| `enterFindMode` | Open the search prompt. |
| `performFind`, `performBackwardsFind` | Go to the next or previous match of the last search. |

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

**Link hints** (Vimium's names and default keys)

| Command | Vimium's key | What it does with the element picked |
|---|---|---|
| `LinkHints.activateMode` | `f` | Click it. A text field is focused instead. |
| `LinkHints.activateModeToOpenInNewTab` | `F` | Open it in a background tab. |
| `LinkHints.activateModeToOpenInNewForegroundTab` | | Open it in a new tab and switch to it. |
| `LinkHints.activateModeWithQueue` | `<a-f>` | Open it in a background tab and hint again, until Escape. |
| `LinkHints.activateModeToCopyLinkUrl` | `yf` | Copy its address. |
| `LinkHints.activateModeToDownloadLink` | | Download it. |

**Vimode**

| Command | What it does |
|---|---|
| `importConfig` | Pick the config files to import (`vimoderc`, `style.css`, or both). |
| `exportConfig` | Download the current config as `vimoderc` (and `style.css`, if one was imported), to edit and import again. |
| `importDefaults` | Load the default keymap, `defaults/vimoderc`, replacing the imported one. An imported `style.css` is kept. |
| `reloadExtension` | Reload Vimode from its directory, and the current tab with it. |

### Styles

An imported `style.css` styles the hints. Its rules come after Vimode's defaults (Vimium's yellow labels), so they win:

| Selector | What it is |
|---|---|
| `.vimode-hint` | One link hint label. |
| `.vimode-hint span` | One character of a label. |
| `.vimode-hint .matched` | A character already typed. |

```css
.vimode-hint { background: #fff785; box-shadow: none; }
```

## Publishing

`./pack.sh` builds `dist/vimode-<version>.zip` for the Chrome Web Store, with the manifest's `key` stripped (the store assigns its own ID and rejects a manifest that pins one). Bump `version` in `manifest.json` before each upload. The listing text, privacy answers and images are in `store/`.

## Privacy

Vimode collects no data. The config files you import are kept in the browser's extension storage and never sent anywhere.

## How it works

`importConfig` parses the picked keymap and stores the result, with the raw files, in extension storage, where every tab's content script picks it up as soon as it changes. Importing is the one manual step: an extension cannot read or watch files on disk by itself.

Keys are handled by a content script in every frame. The status bar is drawn by the top frame, and other frames report their mode to it.

Link hints follow Vimium's design. The background worker asks every frame how many elements it would hint, generates one set of hint strings with Vimium's algorithm (no hint is a prefix of another, and hints sharing a first character are spread across the page), and deals them out. From then on it receives the typed keys from whichever frame has focus, tells every frame what to show, and tells the frame that owns the match what to activate.

## Roadmap

What is done, and what is planned.

**Modes and keys**

- [x] Normal and insert mode
- [x] Counts
- [x] A keymap in a config file
- [x] Fields a page focuses on load do not start insert mode
- [x] Unmapped keys dropped in normal mode
- [ ] Pass the next key to the page
- [ ] Per-site rules to turn keys off (replacing the hardcoded WhatsApp exclusion)
- [ ] Keys matched by position, independent of the keyboard layout

**Scrolling**

- [x] Step, half page, full page and edge scrolling
- [ ] Smooth scrolling
- [ ] Scrolling inner panels, not only the page

**Navigation**

- [x] Back and forward
- [x] Up a level and to the root of the URL
- [x] Reload
- [x] Copy the page's URL
- [x] Focus a text field
- [x] Open a URL or search, with bookmarks and history to pick from
- [ ] Open the URL on the clipboard
- [ ] Previous and next page links
- [ ] View source
- [ ] Frame focus
- [ ] Marks

**Tabs**

- [x] Switch, create, duplicate, close, restore, pin and move tabs
- [x] Close others, to the left, to the right
- [ ] Move a tab to a new window
- [ ] Mute a tab

**Link hints**

- [x] Click, open in a background or foreground tab, open several, copy the link, download
- [x] Hints in every frame
- [x] Custom hint characters and CSS
- [ ] Open in incognito
- [ ] Pick a link by typing its text
- [ ] Hover, focus and copy-link-text hints

**Text**

- [x] Find mode
- [ ] Visual and caret mode

**Interface**

- [x] Status bar
- [x] Command line
- [x] Key hint for half-typed sequences
- [x] Help screen
- [x] Import and reload as commands, no settings page

## Limitations

- Browsers keep extensions off their own pages (`chrome://` and `brave://` pages, the new tab page, the Web Store), so Vimode does nothing there.
- Scrolling moves the page itself. A site that scrolls an inner panel instead of the page does not respond to the scroll commands yet.
- Find mode searches the top page only. Text inside iframes, shadow roots, or drawn on a canvas (Google Docs' editor) is not found.
- The status bar overlays the bottom 20px of the page, since an extension cannot resize the viewport.
- `web.whatsapp.com` is excluded in `manifest.json`, since a page that is all typing has no use for normal mode. Edit `exclude_matches` to change that.
- Hints come from a fixed list of clickable things (links, form controls, ARIA roles, click handlers, `tabindex`, Google's `jsaction`). An element that only a script listening on an ancestor makes clickable is not hinted. Vimium's text-filtering hint mode (`filterLinkHints`) is not implemented.
