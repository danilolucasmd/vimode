# Chrome Web Store listing

The text for the developer dashboard's fields, kept here so a new upload starts from it.

## Store listing

**Summary** (132 characters max)

Vim-style keys for the browser, configured from a dotfile, with a qutebrowser-style status bar.

**Description**

Vimode gives the browser a normal mode and an insert mode, the way Vim does, and takes its whole keymap from a plain text file you keep in your dotfiles.

It works as soon as it is installed, with a default keymap (press ? to see it). To change it, run :exportConfig to download it as a vimoderc file, edit its map and set lines, then run :importConfig on any page and pick it. :importDefaults goes back to the defaults.

Features:
• Normal and insert modes, with a full-width status bar showing the mode, the page URL, and half-typed keys
• Scrolling, history, and tab commands, with counts (3j, 2bd)
• Link hints in every frame: click, open in a new tab, open several, copy the address, download
• Find mode: / highlights every match as you type, n and N step through them
• Open a URL or search (o, O) with bookmarks and history listed as you type
• A command line (:) listing every command, filtered as you type
• A key hint panel for half-typed sequences, and a help screen (?) with every mapped key
• Custom hint characters and CSS

Source and documentation: https://github.com/danilolucasmd/vimode

**Category:** Tools (or Productivity)

**Images:** `icons/icon-128.png`, `store/promo-small.png` (440x280), `store/screenshot-*.png` (1280x800).

## Privacy practices

**Single purpose**

Keyboard navigation of web pages: Vim-style keys for scrolling, following links, searching the page and managing tabs, with a status bar showing the current mode.

**Permission justifications**

- `storage`: keeps the imported keymap and styles so every tab can read them.
- `sessions`: the restoreTab command reopens the last closed tab.
- `clipboardWrite`: the copy commands put the page's URL or a link's address on the clipboard.
- `webNavigation`: link hints list the frames of the current tab so links inside iframes get hints too.
- `history`: the open command lists matching pages from the browser history to pick from as the user types.
- `bookmarks`: the open command lists matching bookmarks to pick from as the user types.
- `search`: text typed into the open command that is not an address is searched with the browser's default search engine.
- Host permission (content script on all URLs): the keys, the status bar, link hints and find mode have to run on every page the user visits.

**Remote code:** No, all code is in the package.

**Data usage:** collects no user data. Nothing leaves the browser; the only stored data is the config file the user imports.

**Privacy policy URL:** not required when no data is collected. If the form insists, use https://github.com/danilolucasmd/vimode#privacy
