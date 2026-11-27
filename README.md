<img src="icons/icon-128.png" width="96" alt="Vimode logo">

# Vimode

Vim-style keyboard navigation for Chromium browsers, configured from a dotfile, with a qutebrowser-style status bar.

Vimode gives a browser a normal mode and an insert mode, like Vimium, and takes its keymap from a plain text file instead of a settings form, so the keymap can live in your dotfiles and follow you from machine to machine. Import the file on the options page, and again after each change.

## Features

- **Modes that work like Vimium's.** Normal mode runs the keymap. Focusing a text field, or pressing the key mapped to `enterInsertMode`, switches to insert mode, where every key goes to the page. Escape leaves insert mode, and leaving a focused field blurs it. Keys the keymap does not use still reach the page in normal mode, so a site's own shortcuts keep working.
- **A status bar.** A full-width strip along the bottom of every page: grey in normal mode, green with `-- INSERT --` in insert mode. The page's URL sits on the right (green for https), replaced by a hovered link's URL in blue, followed by any half-typed key sequence such as `2gb`. Clicks pass through the bar, and it hides in fullscreen.
- **A config file.** Importing it applies it to every open tab at once. A line with a mistake is skipped and reported on the options page, and the rest of the file still loads.
- **Works in every frame,** including Google Docs, whose editor types into a hidden iframe.
- **A command line,** like qutebrowser's. The key mapped to `enterCommandMode` (`:` is the natural choice) opens a prompt in the status bar with every command listed above it, alongside its description and keys. The list narrows as you type, matching each word against the name and description. Tab and Shift-Tab (or the arrows, or Ctrl-N and Ctrl-P) walk the list, Enter runs the command, and Escape closes the prompt. Keys typed into it never reach the page.
- **Counts,** as in Vim: `3j` scrolls three steps, `2bd` closes two tabs.

- **Link hints,** as in Vimium. A hint command labels every clickable thing on screen, in every frame, and typing a label picks it: click it, open it in a background or foreground tab, open several in a row, copy its address, or download it. Labels narrow as you type; Backspace undoes a character, Escape or a click cancels, holding Shift swaps opening in this tab and in a new one, and Space cycles labels that overlap.

## Install

Vimode is loaded unpacked:

1. Clone the repo:

   ```sh
   git clone https://github.com/danilolucasmd/vimode.git ~/Code/vimode
   ```

2. Open `brave://extensions` (or `chrome://extensions`), turn on Developer mode, click "Load unpacked" and choose the repo directory.

3. Open Vimode's options page (right-click the extension icon, then Options) and import your config files (see below).

The browser loads the extension straight from the repo directory, so after changing the code, press the reload button on Vimode's card and reload open tabs.

## Configuration

The config is one or two files, imported on the options page: the keymap (any name, `vimoderc` by convention) and an optional `style.css`. Pick one or both at once; a file ending in `.css` is taken as the styles and anything else as the keymap, and a file not picked keeps what was imported before. Vimode keeps a copy, so import again after editing. The page shows what was imported, when, and any lines that were skipped.

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
| `linkHintCharacters` | `sadfjklewcmpgh` | The characters link hints are made of. Shown in capitals. |
| `passUnmappedKeys` | `true` | Whether a printable key with no mapping reaches the page in normal mode. Set it to `false` to drop such keys, as qutebrowser does; keys with Ctrl, Alt or Meta, and named keys like the arrows, space and Enter, still pass. Google Docs needs `false`: it takes any typed character as editing and switches to insert mode. |

### Commands

Most commands take a count, typed before the key. For `focusInput` the count picks the nth field; for the others it repeats the command.

**Modes**

| Command | What it does |
|---|---|
| `enterInsertMode` | Insert mode until Escape. |
| `enterCommandMode` | Open the command line. |
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

**Link hints** (Vimium's names and default keys)

| Command | Vimium's key | What it does with the element picked |
|---|---|---|
| `LinkHints.activateMode` | `f` | Click it. A text field is focused instead. |
| `LinkHints.activateModeToOpenInNewTab` | `F` | Open it in a background tab. |
| `LinkHints.activateModeToOpenInNewForegroundTab` | | Open it in a new tab and switch to it. |
| `LinkHints.activateModeWithQueue` | `<a-f>` | Open it in a background tab and hint again, until Escape. |
| `LinkHints.activateModeToCopyLinkUrl` | `yf` | Copy its address. |
| `LinkHints.activateModeToDownloadLink` | | Download it. |

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

## How it works

The options page parses the imported keymap and stores the result, with the raw files, in extension storage, where every tab's content script picks it up as soon as it changes. Importing is the one manual step: an extension cannot read or watch files on disk by itself.

Keys are handled by a content script in every frame. The status bar is drawn by the top frame, and other frames report their mode to it.

Link hints follow Vimium's design. The background worker asks every frame how many elements it would hint, generates one set of hint strings with Vimium's algorithm (no hint is a prefix of another, and hints sharing a first character are spread across the page), and deals them out. From then on it receives the typed keys from whichever frame has focus, tells every frame what to show, and tells the frame that owns the match what to activate.

## Limitations

- Browsers keep extensions off their own pages (`chrome://` and `brave://` pages, the new tab page, the Web Store), so Vimode does nothing there.
- Scrolling moves the page itself. A site that scrolls an inner panel instead of the page does not respond to the scroll commands yet.
- The status bar overlays the bottom 20px of the page, since an extension cannot resize the viewport.
- `web.whatsapp.com` is excluded in `manifest.json`, since a page that is all typing has no use for normal mode. Edit `exclude_matches` to change that.
- Hints come from a fixed list of clickable things (links, form controls, ARIA roles, click handlers, `tabindex`, Google's `jsaction`). An element that only a script listening on an ancestor makes clickable is not hinted. Vimium's text-filtering hint mode (`filterLinkHints`) is not implemented.
