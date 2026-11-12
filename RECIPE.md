# Soybean

A dark, editor-shaped Herdr window: a fixed 256px spaces-and-agents sidebar, a Chrome-like tab strip over one bordered terminal pane, a 360px right panel that swaps between Files and GitHub, and a 40px status bar. Built for driving several coding agents at once from a single window.

![Soybean](preview.png)

## What you see

- `root`: a `row` on `background: "canvas"` (#0b0b0b), `theme: "agentee"`, `font: "JetBrains Mono"` at 13, `ui_font: "Geist"`, `terminal_padding: [8,10]`, a 1px `divider` in `border` (#2b2b2b), `titlebar: "none"`, `traffic_lights: [12,16]`, `movable: true`.
- Left `sidebar`: 256px wide (`min: 44`, `max: 420`, `resizable: false`, `background: "chrome"` #111111). A column of four blocks: `brand` 40px `workspace-chrome` (`window_drag: true`), `spaces` `agentee-spaces` (`weight: 1`, `min: 90`), `agents` `agentee-agents-list` (`weight: 1`, `min: 90`), `sidebar-footer` 40px `agentee-chrome` with `props.role: "footer"`.
- Right `work`: a column, `resizable: false`. `tabs` is a 38px `soybean-tabs` strip (`window_drag: true`). `work-body` is a `row` with `padding: 6` and `gap: 6`:
  - `main`: `content: {"tab":"active","pane":{...}}`. The pane has a 30px header on top, `reveal: "always"`, drawn by `pane-chat`; `background: "background"` (#161616), 1px `border` border, 1px `#3d3d3d` focus ring, `radius: 8`, `gap: 6`, `lone: true`.
  - `panel`: 360px (`min: 260`, `max: 760`, `background: "chrome"`), a column holding `panel-body`, a `stack` whose `active` child is `panel-files`. Its two blocks are `panel-files` (`file-icons`) and `panel-gh` (`github`).
  - `status`: 40px `agentee-status`.
- `themes/agentee.json`: `background` #161616, `foreground` #f4f4f4, `canvas` #0b0b0b, `chrome` #111111, `surface` #1c1c1c, `raised` #262626, `border` #2b2b2b, `accent` / `working` #78a9ff, `blocked` #fa4d56, `done` #42be65, `idle` #8d8d8d, `unknown` #be95ff.

## How it behaves

- Agent state in `agentee-agents-list` is grouped into `Needs you` (blocked), `Done`, `Working`, `Idle` by rank 4/3/2/1. Working draws a spinner in `t.working`; blocked draws a `Needs you` chip (or `!` when compact); idle a 7px ring; done a filled dot. Viewing a finished agent keeps it under `Done` until you leave it, then it becomes idle.
- `soybean-tabs`: a working tab spins in `t.working`, blocked and done show 6px dots, `+` opens the shipped `new-menu` popup, dragging a tab onto another calls `tab.move`. On the right of the strip are five 26px buttons: Files and GitHub (`panel-files`, `panel-gh`; clicking a different one runs `layout.show {id:"panel"}` then `layout.select {stack:"panel-body", child:<id>}`, clicking the one already shown runs `layout.hide {id:"panel"}`), Add phone (`mod.open add-phone`), a globe that opens a browser pane (`pane.split` right, argv from `props.browser`, default `herdr-browser-split`), and a graph button that opens `git-graph-vsc` in a new tab. Tabs of mod panes carry no program, so the `MOD_TILES` map draws their tile by hand. Min/max/close buttons appear when `window().buttons` is set.
- `space-home`: the page a space opens on. Every local space keeps one: the sidebar's `agentee-spaces` checks the space on screen at startup and whenever the selection moves, and adds the tab when it is missing — a space the app just created has its starter shell swapped for it. It keeps the ids it has seen and served in `shared("space.home.seen")` and `shared("space.home.made")` (module state would be lost when the mod reloads around a space switch). Background spaces wait until they are picked, because `tab.new` switches the app to the space it adds to. Every creation path is covered, including `space.new` from another mod. It shows the space's name, folder, branch, working tree (`uncommitted`, `ahead`, `behind`), the last six commits, and four buttons: Terminal (`tab.new`), Files and GitHub (`layout.show` + `layout.select` on `panel-body`), Git graph (`tab.new {mod:"git-graph-vsc"}`). Refreshes every 15s; a folder without git lists its entries instead. The tab is pinned: it sits first, it cannot be dragged out of place, and neither the strip nor the tab menu offers Close for it, so closing the last terminal leaves the space standing and a space is only closed from its own menu.
- Space names are unique per machine: the same 250ms check in `agentee-spaces` renames a second space holding a taken name to `-2`, `-3`. Only this machine's spaces are touched, so each app de-duplicates its own. A space is named after the last segment of its folder, and its folder is its own, not wherever a terminal inside it has travelled to.
- `pane-chat` header shows the program icon, the agent name or terminal title, the folder, the status (`Working…`, `Chat`, `Terminal`) and split / zoom / close controls. Clicking it focuses the pane.
- `agentee-spaces`: click a space to `space.select`, right-click for its menu, drag to reorder. Rows show a colored avatar, the name, branch and ahead/behind plus git dots; worktrees nest under their checkout. Under 160px the sidebar mods draw a compact rail (44px, 76px on macOS for the traffic lights).
- `agentee-status` shows the focused folder's git state on the left and the file published to `shared("agentee.editor")` on the right. With no editor it reads `no file open · open a file in Files`; that link shows `panel` and selects `panel-files`. It also exposes a `⌘S` save chip for the editor pane.
- `agentee-chrome` footer opens `picker` (search), `agentee-settings` (theme settings dialog), toggles the right panel, and toggles the sidebar.
- `ctrl-shift-l` cycles layouts; `layout.switch soybean` selects this one. Mods drive `layout.show/hide/select/resize/switch`, `space.new/select`, `tab.new/select/close/rename/move`, `pane.split/close/zoom/focus`, `mod.open` and the window commands.
- The two stacked panels: Files is a lazy file tree with VS Code Material Icon Theme icons and bounded read-only previews; GitHub is a six-tab client for the focused repo (Issues, Pull requests, Actions with CI runs and logs, Milestones, Projects, Repository) with agent briefs and a four-column board. `agentee-editor` is not in the layout: the git graph and `pane.split` open it as a pane, and its own file tabs use the same pills as the window strip.

## Built from

- `layouts/soybean.json`: `row` → `column` (sidebar) + `column` (work) → `row` (work-body) → `stack` (panel-body). `themes/agentee.json` supplies every named color.
- Bundled mods, all `place: "none"`: `agentee-agents-list`, `agentee-chrome`, `agentee-editor`, `agentee-settings`, `agentee-spaces`, `agentee-status`, `agentee-tabs`, `file-icons`, `git-graph-vsc`, `github`, `menu`, `pane-chat`, `soybean-tabs`, `space-home`. Shipped mod used: `workspace-chrome` (brand). Shipped overlays used: `new-menu`, `picker`, `machine-add`.
- `herdr` API used: `spaces`, `panes`, `focused`, `layout`, `window`, `theme`, `shared`, `setShared`, `run`, `openOverlay`, `exec`, `home`, `appHome`, `settings`, `agents`, `terminals`.
- Commands: `layout.show/hide/select/resize/switch`, `space.new/select/move`, `tab.new/select/close/rename/move`, `pane.split/close/zoom/focus/go`, `mod.open`, `app.settings/help/palette`, `window.minimize/maximize/close`, `agentee.git.status/changed`, `agentee.settings`, `agentee-editor.save`, `terminal.pin/peek/keep/kill`.
- Programs executed: `git` (status, log, remote, rev-parse), `sh`, `find`, `tail`, `node`, `env`, `hc`, `herdr-app`, `mkdir`, `sleep`, and `powershell` on Windows.
- Art: `mods/soybean-tabs/icons/{folder,github,globe,graph,smartphone,close}.svg` and `win-{min,max,restore,close}.svg`, `mods/file-icons/icons` + `icons-material` (VS Code Material Icon Theme), `mods/agentee-settings/icons/*.svg`, `mods/agentee-tabs/icons/*.svg`, `mods/git-graph-vsc/*.svg`, `mods/github/icons/*.svg`, `mods/space-home/*.svg`, plus the shipped `mods/workspace-chrome/spinner.svg`.

## Patched upstream mods

- `menu` ← shipped. Local patches (`// soybean:` comments in `main.js`): a tab's menu has no Close when that tab is a space's home page, and a space's folder is its own, not the first terminal's live folder.
- `github` ← [alarboulletmarin/herdr-github](https://github.com/alarboulletmarin/herdr-github) `mods/github`. Local patches (`// soybean:` comments in `main.js`): a 30px header and `rounded(8)` shell so it sits flush with the Files panel, and a panel whose repository follows the folder of the selected space instead of the focused terminal's cwd — a space without a local folder (studio/remote) clears the previous repository instead of showing it. Needs the `gh` CLI; Milestones and Projects need `read:project`.
- `git-graph-vsc` ← [pipisasa/herdr-git-graph](https://github.com/pipisasa/herdr-git-graph). Renamed from `git-graph` (folder, every `"mod"` value and every `mods/git-graph/...` path in its JS), and the pencil next to a diff header opens the file in `agentee-editor` — an existing editor pane in the same tab if there is one, otherwise a new right split.
- `file-icons` is derived from Herdr's shipped `files` mod (Apache-2.0).

## Watch out

- Name clashes: these mod names come from other people's layouts. If one is already installed, rename the folder, every `"mod"` value in `layouts/soybean.json`, and every `mods/<name>/...` path inside the mod's own JS before copying. Never overwrite.
- Fonts: `JetBrains Mono` and `Geist` are not bundled. Without them Herdr falls back and the fixed 38px/40px strips can look different.
- The globe button's command comes from the `tabs` block props: `{"browser": "/Users/soybean/.local/bin/herdr-browser-split"}` — a machine-local path. Change it to your own wrapper, or drop the prop to get `herdr-browser-split` from `PATH`.
- `Add phone` opens the `add-phone` mod, whose `config.js` hardcodes `/Users/soybean/.local/bin/herdr-anywhere`; the icon is bundled locally now, the binary path is not.
- `git-graph-vsc` needs git repositories and parses GitHub remotes. `github` needs the `gh` CLI and an authenticated account. `agentee-chrome` reads `appHome()/agentee-settings.json` only as a fallback when `shared("agentee.settings")` is empty.
- `pane-chat` Autopilot opens `shepherdr-settings` and calls `mods/tasks/bin/herdr-task`; neither mod is installed on the source machine and neither is bundled here. Those controls do nothing until the mods are added.
- Only one child of `panel-body` renders at a time, but hidden children keep their timers. `panel` is 360px by default (`min 260`, `max 760`); `sidebar` has `resizable: false` even though its mods still call `layout.resize`.
- `titlebar: "none"` with `traffic_lights: [12,16]` leaves room for macOS window buttons; `agentee-chrome` pads 76px and `soybean-tabs` computes its own left padding on macOS. Windows draws min/max/close from `mods/soybean-tabs/icons/win-*.svg`.
- Licensing: `file-icons` is derived from Herdr's shipped `files` mod (Apache-2.0), and the `agentee-*` / `github` / `git-graph-vsc` / `pane-chat` mods come from other layouts. None of them ships a licence file here; check the upstream repositories before publishing a derivative.

## Done when

- `herdr-app check <folder>` passes for all 14 bundled mods. Verified on the source machine after packaging: `agentee-agents-list`, `agentee-chrome`, `agentee-editor`, `agentee-settings`, `agentee-spaces`, `agentee-status`, `agentee-tabs`, `file-icons`, `git-graph-vsc`, `github`, `pane-chat`, `soybean-tabs`, `space-home`.
- `layout.switch soybean` shows the sidebar, tab strip, terminal pane, right panel and status bar as in `preview.png`, and `herdr-app status` reports `"layout": "soybean"` with no errors.
- Each right-hand strip button selects its stack child; clicking the active one hides `panel`; `ctrl-shift-l` returns to the previous layout.
- Files lists the focused pane's folder with Material icons, the GitHub panel lists the focused repo's issues and runs, and the graph button opens `git-graph-vsc` on that repo.
- No `mods/<name>/...` asset path in the bundled JS points outside this repo, except the optional Autopilot CLI noted above.
