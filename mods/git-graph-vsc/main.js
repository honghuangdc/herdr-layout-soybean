// Git Graph: the repository's commit graph as in VS Code's Git Graph (mhutchie):
// lanes, ref badges, Date/Author/Commit columns, an expanding details panel with
// changed files and diffs, branch filter, find, fetch, and every context-menu action.
// One mod, three roles: the graph (layout block or tab pane), a context menu
// (props.menu, popup) and an action dialog (props.dialog).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, theme, settings, props, run, openOverlay, closeOverlay, shared, setShared, notify, nextCommand, watchFolder } from "herdr";
import { findRoot, listRepos, loadRepo, commitInfo, changedFiles, fileDiff, diffRows, runSteps, copyText } from "./git.js";
import { layoutGraph, graphCell, graphWidth, ROW, LANE } from "./graph.js";
import { menuItems, action } from "./actions.js";
import { initSettings, renderSettings } from "./settings.js";

const ICON = (n) => `mods/git-graph-vsc/${n}.svg`;
const PAGE = 300;
const UNCOMMITTED = "*";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (s) => { const d = new Date(s * 1000); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const basename = (p) => p.replace(/\/+$/, "").split("/").pop();
const statusColor = (t, s) => (s === "A" ? t.ansi2 : s === "D" || s === "U" ? t.ansi1 : s === "R" ? t.ansi4 : t.blocked);

function location() {
  const p = props() ?? {};
  if (p.folder) return { cwd: p.folder, on: p.on ?? null }; // p.tab: a Git Graph tab that follows its space
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  // A mod pane in focus (this graph as a tab, a viewer) has no folder: use a terminal
  // of the same tab, else any terminal of the space.
  // A mod pane (this graph as a tab) reports its space's folder, not a repo: look at terminals instead.
  const modPane = Boolean(pane && !pane.terminal);
  if (pane?.cwd || (!modPane && f?.cwd)) return { cwd: pane?.cwd || f?.cwd, on };
  // The terminal focused last in this space (shared "git-graph.focus", set by a tab bar mod), then every terminal
  // folder of the space, this tab's first; refresh takes the first that is a repo.
  const last = space ? (shared("git-graph.focus") ?? {})[space.id] : null;
  const tabIds = (space?.tabs ?? []).map((x) => x.id), tab = pane?.tab ?? f?.tab ?? space?.tabs.find((x) => x.active)?.id;
  const order = [tab, ...tabIds.filter((x) => x !== tab)];
  const alts = [...new Set(order.flatMap((id) => panes().filter((x) => x.tab === id && x.cwd).map((x) => x.cwd)))];
  if (last?.cwd) return { cwd: last.cwd, alts: alts.filter((x) => x !== last.cwd), on: last.on ?? on };
  return { cwd: alts[0] || space?.folder, alts: alts.slice(1), on };
}
const cfgOf = (root) => ({ branches: null, remotes: true, tags: true, stashes: true, reflog: false, firstParent: false, name: null, ...((shared("git-graph.cfg") ?? {})[root] ?? {}) });
function setCfg(root, patch) {
  const all = { ...(shared("git-graph.cfg") ?? {}) };
  all[root] = { ...cfgOf(root), ...patch };
  setShared("git-graph.cfg", all);
}
const bump = () => setShared("git-graph.rev", Date.now());

export default class GitGraph extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.role = p.settings ? "settings" : p.menu ? "menu" : p.dialog ? "dialog" : "graph";
    this.handle = cx.focus_handle();
    if (this.role === "settings") return initSettings(this, cx, { cfgOf, setCfg, bump });
    if (this.role === "dialog") return this.initDialog(p, cx);
    if (this.role === "menu") {
      if (p.menu === "repos") {
        this.filter = "";
        this.filterInput = InputState.new({ placeholder: "Filter Repos..." });
        this.filterInput.on("change", (_e, cx) => { this.filter = this.filterInput.value(); cx.notify(); });
        this.filterInput.focus(); cx.timer.after(300, () => this.filterInput.focus());
      } else this.handle.focus();
      return;
    }
    this.list = VirtualListScrollHandle.new();
    this.max = PAGE; this.view = null; this.expanded = null; this.compare = null; this.details = null;
    this.openFile = null; this.diff = []; this.diffWidth = 0; this.sel = -1; this.size = { width: 600, height: 600 };
    this.finding = false; this.query = ""; this.matches = []; this.match = -1; this.message = "";
    this.commitInput = InputState.new({ placeholder: "Commit message" });
    this.commitInput.on("change", (_e, cx) => { const had = Boolean(this.message.trim()); this.message = this.commitInput.value(); if (had !== Boolean(this.message.trim())) cx.notify(); });
    this.commitInput.on("submit", (_e, cx) => this.commit(cx));
    this.commitInput.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.commitInput.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.findInput = InputState.new({ placeholder: "Find message, hash or author" });
    this.findInput.on("change", (_e, cx) => { this.query = this.findInput.value(); this.runFind(true); cx.notify(); });
    this.findInput.on("submit", (_e, cx) => { this.step(1); cx.notify(); });
    this.findInput.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.findInput.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    // Key commands ("<key>": "git-graph:<command>" in keys.json, or `herdr-app do git-graph.<command>`).
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); this.command(c, cx); cx.notify(); } });
  }

  command(c, cx) {
    const v = this.view;
    if (c === "focus") this.handle.focus();
    else if (c === "refresh") { bump(); this.refresh(cx); }
    else if (c === "fetch") this.fetch(cx);
    else if (c === "repos") this.openRepos();
    else if (c === "settings") this.openSettings();
    else if (c === "find") { this.finding = true; this.findInput.focus(); }
    else if (!v) return;
    else if (c === "down" || c === "up") { this.sel = Math.max(0, Math.min(v.list.length - 1, this.sel + (c === "down" ? 1 : -1))); this.reveal(this.sel); }
    else if (c === "toggle" && this.sel >= 0) this.toggle(v.list[this.sel].hash, cx, false);
    else if (c === "compare" && this.sel >= 0) this.toggle(v.list[this.sel].hash, cx, true);
    else if (c === "file" && this.details?.files.length) this.pickFile(this.details.files[0], cx);
    else if (c === "menu" && this.sel >= 0) { const x = v.list[this.sel]; this.openMenu(x.uncommitted ? "uncommitted" : "commit", x); }
    else if (c === "close") { this.expanded = null; this.compare = null; this.details = null; this.openFile = null; }
  }

  // ---------------------------------------------------------------- data

  contextKey() { return JSON.stringify([location(), shared("git-graph.cfg") ?? null, shared("git-graph.rev") ?? 0, shared("git-graph.repo") ?? null, this.max]); }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    const loc = location(), key = this.contextKey(), where = JSON.stringify(loc);
    if (where !== this.where) {
      this.where = where; this.view = null; this.root = null; this.error = null; this.expanded = null; this.compare = null;
      this.details = null; this.openFile = null; this.diff = []; this.sel = -1; this.max = PAGE; this.watched = null; this.message = ""; this.commitInput.set_value("");
    }
    this.key = key;
    if (!loc.cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        if (this.found?.where !== where) {
          let own = await findRoot(loc.cwd, loc.on);
          for (const alt of loc.alts ?? []) { if (own) break; own = await findRoot(alt, loc.on); }
          this.found = { where, own, repos: own ? await listRepos(own, loc.on) : [] };
        }
        if (JSON.stringify(location()) !== where) return;
        const { own, repos } = this.found;
        if (!own) { this.root = null; this.view = null; this.error = `Not a git repository: ${loc.cwd}`; return; }
        // The Repo dropdown's pick for this superproject, else where the folder is.
        const picked = (shared("git-graph.repo") ?? {})[repos[0]];
        const root = picked && repos.includes(picked) ? picked : own;
        if (root !== this.root) { this.expanded = null; this.compare = null; this.details = null; this.openFile = null; this.sel = -1; this.watched = null; }
        this.root = root; this.repos = repos;
        const repo = { root, on: loc.on }, cfg = cfgOf(root);
        const data = await loadRepo(repo, { remotes: cfg.remotes, branches: cfg.branches, tags: cfg.tags, stashes: cfg.stashes, reflog: cfg.reflog, firstParent: cfg.firstParent, max: this.max });
        if (JSON.stringify(location()) !== where) return;
        const list = [];
        if (data.changes.length && data.head) list.push({ hash: UNCOMMITTED, parents: [data.head], subject: `Uncommitted Changes (${data.changes.length})`, uncommitted: true });
        list.push(...data.commits);
        const graph = layoutGraph(list);
        const index = Object.fromEntries(list.map((c, i) => [c.hash, i]));
        this.view = { repo, data, list, graph, index };
        this.error = null;
        if (this.expanded && !(this.expanded in index)) { this.expanded = null; this.compare = null; this.details = null; this.openFile = null; }
        if (this.expanded === UNCOMMITTED || this.compare === UNCOMMITTED) this.loadDetails(cx, true);
        if (this.query) this.runFind(false);
        this.watch(repo, cx);
      } catch (e) { if (JSON.stringify(location()) === where) this.error = String(e.message ?? e); }
      finally {
        this.loading = false; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  watch(repo, cx) {
    if (repo.on || this.watched === repo.root) return;
    const root = repo.root;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched !== root || this.pendingWatch) continue;
          this.pendingWatch = true;
          cx.timer.after(1200, (cx) => { this.pendingWatch = false; this.refresh(cx); });
        }
      } catch { this.watched = null; }
    });
  }

  toggle(hash, cx, compare) {
    if (compare && this.expanded && this.expanded !== hash) { this.compare = this.compare === hash ? null : hash; }
    else if (this.expanded === hash) { this.expanded = null; this.compare = null; }
    else { this.expanded = hash; this.compare = null; }
    this.details = null; this.openFile = null; this.diff = [];
    if (this.view && this.expanded) { this.sel = this.view.index[this.expanded]; this.loadDetails(cx, false); }
    cx.notify();
  }

  // from/to for the expanded (and compared) commit. to null: working tree.
  range() {
    const v = this.view, a = this.expanded, b = this.compare;
    if (!b) {
      if (a === UNCOMMITTED) return { from: "HEAD", to: null };
      const c = v.list[v.index[a]];
      return { from: c.parents[0] ?? null, to: a };
    }
    const [newer, older] = v.index[a] < v.index[b] ? [a, b] : [b, a];
    return { from: older, to: newer === UNCOMMITTED ? null : newer };
  }

  loadDetails(cx, keep) {
    const v = this.view, a = this.expanded, b = this.compare, token = {};
    this.token = token;
    const { from, to } = this.range();
    cx.spawn(async (cx) => {
      try {
        const info = a !== UNCOMMITTED && !b ? await commitInfo(v.repo, a) : null;
        let files;
        if (to === null) {
          const tracked = v.data.head ? await changedFiles(v.repo, from, null) : [];
          const seen = new Set(tracked.map((f) => f.path));
          const untracked = from === "HEAD" ? v.data.changes.filter((f) => f.untracked && !seen.has(f.path)).map((f) => ({ ...f, add: 0, del: 0 })) : [];
          files = [...tracked.map((f) => ({ ...f, conflict: v.data.changes.find((c) => c.path === f.path)?.conflict })), ...untracked];
          for (const f of files) if (f.conflict) f.status = "U";
        } else files = await changedFiles(v.repo, from, to);
        if (this.token !== token) return;
        this.details = { info, files, from, to };
        if (keep && this.openFile) {
          const f = files.find((x) => x.path === this.openFile.path);
          if (f) await this.loadDiff(f, cx); else { this.openFile = null; this.diff = []; }
        }
      } catch (e) { if (this.token === token) this.details = { error: String(e.message ?? e), files: [] }; }
      cx.notify();
    });
  }

  async loadDiff(file, cx) {
    const d = this.details;
    try {
      const lines = await fileDiff(this.view.repo, d.from, d.to, file);
      if (this.details !== d || this.openFile?.path !== file.path) return;
      this.diff = diffRows(lines);
      this.diffWidth = Math.max(300, ...this.diff.map((r) => (r.text.length + 1) * 7 + 90));
    } catch (e) { this.diff = diffRows([`Cannot preview this diff: ${e.message ?? e}`]); }
    cx.notify();
  }

  pickFile(file, cx) {
    if (this.openFile?.path === file.path) { this.openFile = null; this.diff = []; cx.notify(); return; }
    this.openFile = file; this.diff = [];
    cx.spawn(async (cx) => this.loadDiff(file, cx));
    cx.notify();
  }

  commit(cx) {
    const v = this.view;
    if (!v || !this.message.trim() || this.busy) return;
    const message = this.message.trim(), repo = v.repo;
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        await runSteps(repo, [["add", "-A"], ["commit", "-m", message]]);
        this.message = ""; this.commitInput.set_value("");
        this.expanded = null; this.details = null; this.openFile = null;
        bump();
      } catch (e) { this.note = `Commit failed: ${e.message ?? e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  fetch(cx) {
    const v = this.view;
    if (!v || this.fetching) return;
    this.fetching = true;
    cx.spawn(async (cx) => {
      try { await runSteps(v.repo, [["fetch", "--all", "--prune"]]); bump(); }
      catch (e) { notify({ title: "Fetch failed", body: String(e.message ?? e), level: "error" }); }
      finally { this.fetching = false; cx.notify(); }
    });
    cx.notify();
  }

  runFind(jump) {
    const v = this.view, q = this.query.trim().toLowerCase();
    if (!v || !q) { this.matches = []; this.match = -1; return; }
    this.matches = v.list.map((c, i) => [c, i]).filter(([c]) => !c.uncommitted && (c.subject.toLowerCase().includes(q) || c.hash.startsWith(q) || c.author.toLowerCase().includes(q))).map(([, i]) => i);
    if (jump || this.match >= this.matches.length) { this.match = this.matches.length ? 0 : -1; if (jump) this.reveal(this.matches[0]); }
  }

  step(d) {
    if (!this.matches.length) return;
    this.match = (this.match + d + this.matches.length) % this.matches.length;
    this.reveal(this.matches[this.match]);
  }

  reveal(i) {
    if (i === undefined || i < 0) return;
    this.sel = i;
    this.list.scroll_to_item(i, "center");
  }

  ctx() {
    const d = this.view.data;
    return { headBranch: d.headBranch, remotes: d.remotes, branches: d.branches, remoteBranches: d.remoteBranches };
  }

  openMenu(kind, target) {
    const refs = kind === "commit" ? (this.view.data.refs[target.hash] ?? []) : [];
    openMenuOverlay(kind, target, this.ctx(), this.view.repo, refs);
  }

  openSettings() {
    if (this.root) openOverlay({ mod: "git-graph-vsc", kind: "dialog", width: 520, height: 0.85, props: { settings: true, repo: { root: this.root, on: this.view?.repo.on ?? null } } });
  }

  openRepos() {
    if (!this.repos?.length) return;
    openOverlay({ mod: "git-graph-vsc", kind: "popup", width: 280, height: Math.min(420, 60 + this.repos.length * 28), props: { menu: "repos", repos: this.repos, current: this.root, on: this.view?.repo.on ?? null } });
  }

  openBranches() {
    const d = this.view.data;
    openOverlay({ mod: "git-graph-vsc", kind: "popup", width: 300, height: 380, props: { menu: "branches", repo: this.view.repo, branches: d.branches, remoteBranches: d.remoteBranches } });
  }

  // ---------------------------------------------------------------- graph view

  render(cx) {
    if (this.role === "settings") return renderSettings(this, cx);
    if (this.role === "menu") return this.renderMenu(cx);
    if (this.role === "dialog") return this.renderDialog(cx);
    if (this.contextKey() !== this.key) this.refresh(cx);
    const t = theme(), v = this.view, W = this.size.width;
    const cols = { date: W >= 640, author: W >= 800, hash: W >= 500 };
    const framed = !props()?.folder && !props()?.tab && !props()?.overlay; // tabs and overlays have Herdr's frame
    return v_flex().id("git-graph-vsc").size_full().min_h(0).overflow_hidden().when(framed, (e) => e.rounded(10).border_1().border_color(t.border)).bg(t.background).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_mouse_down("left", (_e, _cx) => { if (!this.typing) this.handle.focus(); })
      .on_key_down((e, cx) => this.key_(e, cx))
      .on_modifiers_changed((e) => { this.mods = e.modifiers; })
      .child(this.toolbar(t, v, cx))
      .when(this.finding, (el) => el.child(this.findBar(t)))
      .child(this.header(t, cols, v))
      .child(this.table(t, cols, v, cx))
      .when(Boolean(v && this.expanded), (el) => el.child(this.detailsPanel(t, v, Math.round(Math.max(220, Math.min(560, this.size.height * 0.45))))));
  }

  key_(e, cx) {
    const ks = e.keystroke;
    if (ks === "cmd-f" || ks === "ctrl-f") { this.finding = true; this.findInput.focus(); cx.stop_propagation(); cx.notify(); return; }
    if (e.key === "escape") {
      if (this.typing) { this.typing = false; this.handle.focus(); }
      else if (this.finding) { this.finding = false; this.query = ""; this.findInput.set_value(""); this.matches = []; }
      else if (this.openFile) { this.openFile = null; this.diff = []; }
      else if (this.expanded) { this.expanded = null; this.compare = null; this.details = null; }
      else return;
      cx.stop_propagation(); cx.notify(); return;
    }
    if (this.typing || !this.view) return;
    const n = this.view.list.length;
    if (e.key === "down" || e.key === "up") {
      this.sel = Math.max(0, Math.min(n - 1, (this.sel < 0 ? -1 : this.sel) + (e.key === "down" ? 1 : -1)));
      this.reveal(this.sel); cx.stop_propagation(); cx.notify();
    } else if (e.key === "enter" && this.sel >= 0) { this.toggle(this.view.list[this.sel].hash, cx, false); cx.stop_propagation(); }
  }

  iconButton(t, id, icon, tip, onClick, { spin = false, on = false } = {}) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(on ? t.foreground : t.muted).when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onClick(cx))
      .child(spin ? svg("mods/git-graph-vsc/spinner.svg").size(14).spin(900) : svg(ICON(icon)).size(14));
  }

  toolbar(t, v, cx) {
    const cfg = this.root ? cfgOf(this.root) : { branches: null, remotes: true };
    const label = (s) => div().font_bold().text_size(12.5).child(s);
    const drop = (id, text, w, onClick) => h_flex().id(id).h(26).px(8).gap(6).items_center().rounded(4).border_1().border_color(t.input).bg(t.background).cursor_pointer().w(w).flex_shrink(1).min_w(80)
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(onClick)
      .child(div().flex_1().min_w(0).truncate().child(text)).child(svg(ICON("chevron-down")).size(12).text_color(t.dim));
    const branchText = !cfg.branches?.length ? "Show All" : cfg.branches.length === 1 ? cfg.branches[0] : `${cfg.branches.length} branches`;
    const box = (on) => div().size(14).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background).flex().items_center().justify_center()
      .when(on, (e) => e.child(div().text_size(10).text_color(t.accent_foreground).child("✓")));
    return h_flex().h(40).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(label("Repo:")).child(drop("gg-repo", this.root ? cfg.name || basename(this.root) : "—", 200, () => this.openRepos()))
      .when(this.size.width >= 460, (e) => e.child(label("Branches:")).child(drop("gg-branches", branchText, this.size.width >= 1000 ? 320 : 180, () => v && this.openBranches())))
      .when(this.size.width >= 560, (e) => e.child(h_flex().id("gg-remotes").gap(6).items_center().cursor_pointer().text_size(12).text_color(t.muted)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(() => this.root && setCfg(this.root, { remotes: !cfg.remotes }))
        .child(box(cfg.remotes)).child(div().font_bold().text_color(t.foreground).child("Show Remote Branches"))))
      .child(div().flex_1())
      .when(this.loading && !v, (e) => e.child(svg("mods/git-graph-vsc/spinner.svg").size(13).text_color(t.dim).spin(900)))
      .child(this.iconButton(t, "gg-find", "search", "Find (⌘F)", (cx) => { this.finding = !this.finding; if (this.finding) this.findInput.focus(); cx.notify(); }, { on: this.finding }))
      .child(this.iconButton(t, "gg-term", "terminal", "Open a Terminal for this Repository", () => this.root && run("terminal.open", { folder: this.root, place: "down" })))
      .child(this.iconButton(t, "gg-settings", "settings", "Repository Settings", () => this.openSettings()))
      .child(this.iconButton(t, "gg-fetch", "fetch", "Fetch from Remote(s)", (cx) => this.fetch(cx), { spin: this.fetching }))
      .child(this.iconButton(t, "gg-refresh", "refresh", "Refresh", (cx) => { bump(); this.refresh(cx); }))
      .when(!props()?.folder && !props()?.tab, (e) => e.child(this.iconButton(t, "gg-full", "expand", "Open as a tab", () => this.fullscreen())));
  }

  // Opens this repo's graph as a tab (and closes the overlay it was opened in, if any).
  fullscreen() {
    if (!this.root) return;
    const overlay = props()?.overlay;
    run("tab.new", { mod: "git-graph-vsc", name: `Git Graph · ${basename(this.root)}`, props: { folder: this.root, on: this.view?.repo.on ?? null } });
    if (overlay) closeOverlay(overlay);
  }

  findBar(t) {
    const count = this.matches.length ? `${this.match + 1} of ${this.matches.length}` : this.query ? "No results" : "";
    return h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().id("gg-find-input").flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1().border_color(this.typing ? t.accent : t.input).bg(t.background).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.findInput).h_full().text_size(12).text_color(t.foreground)))
      .child(div().w(80).text_size(11.5).text_color(t.dim).child(count))
      .child(this.textButton(t, "gg-find-prev", "↑", (cx) => { this.step(-1); cx.notify(); }))
      .child(this.textButton(t, "gg-find-next", "↓", (cx) => { this.step(1); cx.notify(); }))
      .child(this.iconButton(t, "gg-find-close", "x", "Close", (cx) => { this.finding = false; this.query = ""; this.findInput.set_value(""); this.matches = []; this.handle.focus(); cx.notify(); }));
  }

  textButton(t, id, label, onClick) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onClick(cx)).child(label);
  }

  graphLanes(v) {
    const cap = Math.max(3, Math.floor((this.size.width * 0.22) / LANE));
    return Math.min(v?.graph.width ?? 1, cap);
  }

  header(t, cols, v) {
    const h = (w, s) => div().w(w).flex_none().h_full().flex().items_center().justify_center().border_l(1).border_color(t.border).truncate().child(s);
    return h_flex().h(28).flex_none().items_center().border_b(1).border_color(t.border).text_size(12.5).font_bold().text_color(t.foreground).bg(t.background)
      .child(div().w(Math.max(60, graphWidth(this.graphLanes(v)))).flex_none().h_full().flex().items_center().justify_center().child("Graph"))
      .child(div().flex_1().min_w(0).h_full().flex().items_center().justify_center().border_l(1).border_color(t.border).child("Description"))
      .when(cols.date, (e) => e.child(h(132, "Date")))
      .when(cols.author, (e) => e.child(h(130, "Author")))
      .when(cols.hash, (e) => e.child(h(78, "Commit")));
  }

  table(t, cols, v, cx) {
    const body = div().flex_1().min_h(0).relative();
    if (!v) return body.child(div().p(12).text_color(t.dim).child(this.error || (!location().cwd ? "No folder" : "Loading…")));
    const n = v.list.length + (v.data.more ? 1 : 0);
    const sizes = Array.from({ length: n }, (_x, i) => (i < v.list.length ? ROW : 40));
    const lanes = this.graphLanes(v);
    const key = (i) => (i < v.list.length ? v.list[i].hash : "more");
    return body
      .child(v_virtual_list("gg-rows", n, sizes, key, (range) => {
        const out = [];
        for (let i = range.start; i < range.end; i++) out.push(i < v.list.length ? this.row(t, cols, v, i, lanes) : this.moreButton(t));
        return out;
      }).size_full().track_scroll(this.list)
        .on_item_click((k, cx) => {
          if (k === "more") { this.max += PAGE; this.refresh(cx); return; }
          this.handle.focus();
          this.toggle(k, cx, Boolean(this.mods?.platform || this.mods?.control));
        })
        .on_item_secondary_click((k, _e, cx) => {
          const c = this.view?.list[this.view.index[k]];
          if (!c) return;
          cx.stop_propagation();
          this.openMenu(c.uncommitted ? "uncommitted" : c.stash ? "stash" : "commit", c);
        }))
      .child(Scrollbar.vertical("gg-rows").viewport_from_layout().absolute().inset_0());
  }

  moreButton(t) {
    return h_flex().h(40).w_full().justify_center().items_center()
      .child(div().h(26).px(14).flex().items_center().rounded(6).border_1().border_color(t.input).bg(t.raised).cursor_pointer().text_size(12).child("Load More Commits"));
  }

  badges(t, v, c, color) {
    const refs = v.data.refs[c.hash] ?? [];
    const out = [];
    const heads = refs.filter((r) => r.type === "head"), remotes = refs.filter((r) => r.type === "remote"), tags = refs.filter((r) => r.type === "tag");
    const used = new Set();
    const badge = (_id, icon, name, bold, extra, _target, _kind, border) =>
      h_flex().h(18).flex_none().items_center().rounded(4).border_1().border_color(border).overflow_hidden().text_size(11.5)
        .child(div().h_full().px(3).flex().items_center().bg(border).text_color("#ffffff").child(svg(ICON(icon)).size(11)))
        .child(div().px(5).max_w(420).truncate().when(bold, (e) => e.font_bold()).child(name))
        .children(extra);
    if (!v.data.headBranch && c.hash === v.data.head) out.push(badge(`b-HEAD-${c.hash}`, "branch", "HEAD", true, [], { type: "commit", ...c }, "commit", color));
    for (const h of heads) {
      const same = remotes.filter((r) => r.short === h.name);
      same.forEach((r) => used.add(r.name));
      const extra = same.map((r) => div().h_full().px(5).flex().items_center().border_l(1).border_color(color).text_color(t.muted).italic().child(r.remote));
      out.push(badge(`b-${h.name}`, "branch", h.name, h.name === v.data.headBranch, extra, h, "head", color));
    }
    for (const r of remotes) if (!used.has(r.name)) out.push(badge(`b-${r.name}`, "branch", r.name, false, [], r, "remote", color));
    for (const g of tags) out.push(badge(`t-${g.name}`, "tag", g.name, false, [], g, "tag", color));
    return out;
  }

  row(t, cols, v, i, lanes) {
    const c = v.list[i], g = v.graph.rows[i];
    const selected = this.expanded === c.hash || this.compare === c.hash;
    const matchNow = this.matches.length && this.matches[this.match] === i, matched = !matchNow && this.query && this.matches.includes(i);
    // Git Graph greys out merge commits; the uncommitted row is bold.
    const merge = c.parents.length > 1;
    const fg = merge ? t.dim : t.foreground;
    const cell = (w, s) => div().w(w).flex_none().px(6).truncate().text_color(fg).child(s);
    return h_flex().h(ROW).w_full().items_center().cursor_pointer()
      .when(selected, (e) => e.bg(t.selected)).when(!selected && this.sel === i, (e) => e.bg(t.hover))
      .when(Boolean(matched), (e) => e.bg(t.accent + "22")).when(Boolean(matchNow), (e) => e.bg(t.accent + "44"))
      .hover((s) => s.bg(t.hover))
      .child(div().w(Math.max(60, graphWidth(lanes))).flex_none().overflow_hidden()
        .child(graphCell(g, v.graph.width, { head: c.hash === v.data.head, pending: c.uncommitted, stash: Boolean(c.stash), bg: selected ? t.selected : t.background, muted: t.dim })))
      .child(h_flex().flex_1().min_w(0).px(6).gap(5).items_center()
        .children(c.uncommitted ? [] : c.stash ? [h_flex().h(18).flex_none().items_center().rounded(4).border_1().border_color(t.muted).overflow_hidden().text_size(11.5)
          .child(div().h_full().px(3).flex().items_center().bg(t.muted).text_color(t.background).child(svg(ICON("stash")).size(11))).child(div().px(5).child(c.stash))] : this.badges(t, v, c, g.color))
        .child(div().min_w(0).truncate().text_color(fg).when(Boolean(c.uncommitted), (e) => e.font_bold()).child(c.subject)))
      .when(cols.date, (e) => e.child(cell(132, fmtDate(c.uncommitted ? Date.now() / 1000 : c.date))))
      .when(cols.author, (e) => e.child(cell(130, c.uncommitted ? "*" : c.author)))
      .when(cols.hash, (e) => e.child(cell(78, c.uncommitted ? "*" : c.hash.slice(0, 8))));
  }

  // ---------------------------------------------------------------- details

  detailsPanel(t, v, DH) {
    const d = this.details, wide = this.size.width >= 900;
    const panel = h_flex().id("gg-details").h(DH).flex_none().w_full().relative().border_t(1).border_color(t.accent + "88").bg(t.surface);
    const close = this.iconButton(t, "gg-details-close", "x", "Close", (cx) => { this.expanded = null; this.compare = null; this.details = null; this.openFile = null; cx.notify(); });
    if (!d) return panel.child(div().p(12).text_color(t.dim).child("Loading…")).child(div().absolute().top(6).right(8).child(close));
    if (d.error) return panel.child(div().p(12).text_color(t.ansi1).child(d.error)).child(div().absolute().top(6).right(8).child(close));
    const files = this.fileList(t, d);
    if (this.openFile) {
      return panel.when(wide, (e) => e.child(div().w(320).flex_none().h_full().border_r(1).border_color(t.border).child(files)))
        .child(div().flex_1().min_w(0).h_full().child(this.diffView(t, wide)));
    }
    return panel.child(div().flex_1().min_w(0).h_full().border_r(1).border_color(t.border).child(this.meta(t, v, d)))
      .child(div().flex_1().min_w(0).h_full().child(files))
      .child(div().absolute().top(6).right(8).child(close));
  }

  meta(t, v, d) {
    const line = (k, val) => h_flex().gap(6).items_start().child(div().w(78).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).child(val));
    const mono = settings().font_family ?? "JetBrains Mono";
    const body = v_flex().id("gg-meta").size_full().overflow_y_scrollbar().p(12).pr(40).gap(4).text_size(12);
    if (this.compare) {
      const { from, to } = d;
      return body.child(div().font_semibold().child("Comparing"))
        .child(line("From", div().font_family(mono).child(from?.slice(0, 8) ?? "root")))
        .child(line("To", div().font_family(mono).child(to ? to.slice(0, 8) : "Uncommitted Changes")))
        .child(div().pt(8).text_color(t.dim).child(`${d.files.length} files changed`));
    }
    if (this.expanded === UNCOMMITTED) {
      const enabled = Boolean(this.message.trim() && !this.busy);
      return body.child(div().font_semibold().child("Uncommitted Changes"))
        .child(div().text_color(t.dim).child(`${d.files.length} files · on ${v.data.headBranch ?? "detached HEAD"}`))
        .child(div().h(8))
        .child(div().id("gg-commit-message").w_full().h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.input).bg(t.background).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.commitInput).h_full().text_size(12).text_color(t.foreground)))
        .child(h_flex().pt(6).gap(8).items_center()
          .child(div().id("gg-commit").h(30).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12)
            .when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit all"))
          .child(div().text_size(11).text_color(t.dim).child("git add -A && git commit")))
        .when(Boolean(this.note), (e) => e.child(div().pt(6).text_size(11.5).text_color(t.ansi1).child(this.note)));
    }
    const i = d.info;
    if (!i) return body;
    return body
      .child(line("Commit", div().font_family(mono).child(i.hash)))
      .child(line("Parents", h_flex().gap(6).flex_wrap().children(i.parents.length ? i.parents.map((p) => div().id(`gg-parent-${p}`).font_family(mono).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { if (p in v.index) { this.toggle(p, cx, false); this.reveal(v.index[p]); } }).child(p.slice(0, 8))) : [div().text_color(t.dim).child("none")])))
      .child(line("Author", `${i.author} <${i.email}>`))
      .when(i.committer !== i.author || i.cemail !== i.email, (e) => e.child(line("Committer", `${i.committer} <${i.cemail}>`)))
      .child(line("Date", fmtDate(i.date)))
      .child(div().h(8))
      .children(i.body.split("\n").map((l, k) => div().id(`gg-body-${k}`).min_h(16).child(l || " ")));
  }

  fileList(t, d) {
    const files = d.files;
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(12).child("Changed Files"))
        .child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(files.length)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.ansi2).child(`+${files.reduce((n, f) => n + (f.add || 0), 0)}`))
        .child(div().text_size(11).text_color(t.ansi1).pr(this.openFile ? 0 : 30).child(`−${files.reduce((n, f) => n + (f.del || 0), 0)}`)))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("gg-files").absolute().inset_0().overflow_y_scroll().p(4).children(files.map((f) => {
          const parts = f.path.split("/"), name = parts.pop();
          return h_flex().id(`gg-f-${f.path}`).h(24).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
            .when(this.openFile?.path === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.pickFile(f, cx)).tooltip(f.old ? `${f.old} → ${f.path}` : f.path)
            .child(div().w(12).flex_none().text_size(11).text_color(statusColor(t, f.status)).child(f.status))
            .child(h_flex().flex_1().min_w(0).child(div().max_w(260).min_w(0).flex_none().truncate().child(name)).child(div().pl(6).min_w(0).truncate().text_color(t.dim).text_size(11.5).child(parts.join("/"))))
            .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
            .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
        })).when(!files.length, (e) => e.child(div().p(8).text_color(t.dim).child("No changes"))))
        .child(Scrollbar.vertical("gg-files").absolute().inset_0()));
  }

  diffView(t, wide) {
    const f = this.openFile, mono = settings().font_family ?? "JetBrains Mono";
    const row = ({ kind, number, old, text }) => {
      if (kind === "@") return div().w_full().px(12).h(18).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
      return h_flex().w_full().h(18).flex_none().gap(8).when(kind === "+", (e) => e.bg(t.ansi2 + "1c")).when(kind === "-", (e) => e.bg(t.ansi1 + "1c"))
        .child(div().w(32).flex_none().text_right().text_color(t.dim).child(old === undefined ? "" : String(old)))
        .child(div().w(32).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
        .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === "+" || kind === "-" ? kind : ""))
        .child(div().flex_1().min_w(0).whitespace_nowrap().child(text));
    };
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
        .when(!wide, (e) => e.child(this.textButton(t, "gg-diff-back", "←", (cx) => { this.openFile = null; this.diff = []; cx.notify(); })))
        .child(div().w(12).text_size(11).text_color(statusColor(t, f.status)).child(f.status))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(f.old ? `${f.old} → ${f.path}` : f.path))
        .child(this.iconButton(t, "gg-diff-editor", "edit", "Open the file in the editor", () => {
          // Reuse an editor pane already in this tab, the way the explorer does; else split one to the right.
          const abs = `${this.root}/${f.path}`, on = this.view?.repo.on ?? null, here = focused()?.tab ?? null;
          const pane = panes().find((p) => p.mod === "agentee-editor" && p.tab === here);
          if (pane) {
            setShared("agentee.open", { path: abs, root: this.root, on, tab: pane.tab, nonce: `${Date.now()}-${Math.random()}` });
            return;
          }
          run("pane.split", { direction: "right", mod: "agentee-editor", props: { path: abs, root: this.root, on } });
        }))
        .child(this.iconButton(t, "gg-diff-close", "x", "Close diff", (cx) => { this.openFile = null; this.diff = []; cx.notify(); })))
      .child(div().flex_1().min_h(0).relative().font_family(mono).text_size(11.5)
        .child(div().id("gg-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("gg-diff", this.diff.length, 18, (i) => String(i),
            (range) => this.diff.slice(range.start, range.end).map(row)).size_full())))
        .child(Scrollbar.vertical("gg-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.diff.length, (e) => e.child(div().absolute().top(8).px(12).text_color(t.dim).child("Loading diff…"))));
  }

  // ---------------------------------------------------------------- menu role

  renderMenu() {
    const p = props(), t = theme();
    if (p.menu === "branches") return this.renderBranches(p, t);
    if (p.menu === "repos") return this.renderRepos(p, t);
    const clean = menuList(p.menu, p.target, p.ctx, p.refs);
    return v_flex().id("gg-menu").size_full().p(6).bg(t.popover).text_size(12.5).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .children(clean.map((it, k) => it === "-" ? div().h(1).my(4).mx(4).bg(t.border) :
        h_flex().id(`gg-mi-${k}`).h(26).px(10).items_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover))
          .when(this.busy === k, (e) => e.text_color(t.dim))
          .on_click((_e, cx) => this.menuPick(it, k, p, cx)).child(this.busy === k ? `${it.label.replace(/…$/, "")}…` : it.label)));
  }

  menuPick(it, k, p, cx) {
    if (this.busy !== undefined && this.busy !== null) return;
    if (it.sub) { closeOverlay(p.overlay); openMenuOverlay(it.sub.kind, it.sub.target, p.ctx, p.repo, []); return; }
    if (it.action) {
      const a = action(it.action, p.target, p.ctx);
      closeOverlay(p.overlay);
      openOverlay({ mod: "git-graph-vsc", kind: "dialog", width: 460, height: dialogHeight(a), props: { dialog: it.action, target: p.target, ctx: p.ctx, repo: p.repo } });
      return;
    }
    if (it.now === "terminal") { closeOverlay(p.overlay); run("terminal.open", { folder: p.repo.root, place: "right" }); return; }
    this.busy = k; cx.notify();
    cx.spawn(async () => {
      try {
        if (it.now === "copy") await copyText(it.value);
        else if (it.now === "checkout") { await runSteps(p.repo, [["checkout", p.target.name]]); bump(); }
      } catch (e) { notify({ title: "Git Graph", body: String(e.message ?? e), level: "error" }); }
      closeOverlay(p.overlay);
    });
  }

  renderRepos(p, t) {
    const q = this.filter.trim().toLowerCase(), base = p.repos[0];
    const name = (r) => (r === base ? basename(r) : r.slice(base.length + 1));
    const pick = (r) => { setShared("git-graph.repo", { ...(shared("git-graph.repo") ?? {}), [base]: r }); closeOverlay(p.overlay); };
    return v_flex().id("gg-repo-menu").size_full().overflow_y_scrollbar().p(6).gap(4).bg(t.popover).text_size(12.5).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(div().h(28).px(8).flex().items_center().rounded(4).border_1().border_color(t.accent).bg(t.background).child(Input.new(this.filterInput).h_full().text_size(12.5).text_color(t.foreground)))
      // A popup sizes to its content: a flex_1 list gets no height, so the rows go in a plain column.
      .children(p.repos.filter((r) => !q || name(r).toLowerCase().includes(q)).map((r) =>
        h_flex().id(`gg-repo-${r}`).h(28).px(8).flex_none().items_center().rounded(4).cursor_pointer().when(r === p.current, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click(() => pick(r)).tooltip(r).child(div().min_w(0).truncate().child(name(r)))));
  }

  renderBranches(p, t) {
    const root = p.repo.root, cfg = cfgOf(root), sel = new Set(cfg.branches ?? []);
    const toggle = (name) => {
      const next = new Set(sel);
      next.has(name) ? next.delete(name) : next.add(name);
      setCfg(root, { branches: next.size ? [...next] : null });
    };
    const item = (id, name, on, onClick) => h_flex().id(id).h(24).px(8).gap(8).items_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(div().size(14).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background).flex().items_center().justify_center()
        .when(on, (e) => e.child(div().text_size(10).text_color(t.accent_foreground).child("✓"))))
      .child(div().min_w(0).truncate().child(name));
    const section = (s) => div().px(8).pt(8).pb(2).text_size(11).text_color(t.dim).child(s);
    return v_flex().id("gg-branch-menu").size_full().p(6).bg(t.popover).text_size(12.5).text_color(t.foreground).overflow_y_scrollbar().track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(item("gg-all", "Show All", !sel.size, () => setCfg(root, { branches: null })))
      .child(section("Local"))
      .children(p.branches.map((b) => item(`gg-lb-${b}`, b, sel.has(b), () => toggle(b))))
      .when(cfg.remotes && p.remoteBranches.length > 0, (e) => e.child(section("Remote")).children(p.remoteBranches.map((b) => item(`gg-rb-${b}`, b, sel.has(b), () => toggle(b)))));
  }

  // ---------------------------------------------------------------- dialog role

  initDialog(p, cx) {
    this.def = action(p.dialog, p.target, p.ctx);
    this.values = {}; this.inputs = {};
    for (const f of this.def?.fields ?? []) {
      this.values[f.key] = f.value;
      if (f.type === "text") {
        const s = InputState.new({ placeholder: f.placeholder ?? "", value: f.value ?? "" });
        s.on("change", (_e, cx) => { this.values[f.key] = s.value(); cx.notify(); });
        s.on("submit", (_e, cx) => this.confirm(cx));
        this.inputs[f.key] = s;
      }
    }
    const first = (this.def?.fields ?? []).find((f) => f.type === "text");
    if (first) { this.inputs[first.key].focus(); cx.timer.after(300, () => this.inputs[first.key].focus()); }
    else this.handle.focus();
  }

  confirm(cx) {
    const p = props(), def = this.def;
    if (!def || this.busy) return;
    if ((def.need ?? []).some((k) => !String(this.values[k] ?? "").trim())) { this.error = "Fill in the required fields"; cx.notify(); return; }
    const values = Object.fromEntries(Object.entries(this.values).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try { await runSteps(p.repo, def.steps(values)); bump(); closeOverlay(p.overlay); }
      catch (e) { this.error = String(e.message ?? e); bump(); this.busy = false; cx.notify(); }
    });
  }

  renderDialog(cx) {
    const p = props(), t = theme(), def = this.def;
    if (!def) return div().p(16).child("Unknown action");
    const fieldEl = (f) => {
      if (f.type === "text") return v_flex().gap(4)
        .child(div().text_size(11.5).text_color(t.dim).child(f.label))
        .child(div().id(`gg-in-${f.key}`).h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.input).bg(t.background).cursor_text()
          .child(Input.new(this.inputs[f.key]).h_full().text_size(12.5).text_color(t.foreground)));
      const box = (on, round) => div().size(14).flex_none().rounded(round ? 7 : 3).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background).flex().items_center().justify_center()
        .when(on, (e) => e.child(round ? div().size(6).rounded(3).bg(t.accent_foreground) : div().text_size(10).text_color(t.accent_foreground).child("✓")));
      if (f.type === "check") return h_flex().id(`gg-ck-${f.key}`).h(24).gap(8).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.values[f.key] = !this.values[f.key]; cx.notify(); }).child(box(Boolean(this.values[f.key]), false)).child(f.label);
      return v_flex().gap(2).child(div().text_size(11.5).text_color(t.dim).child(f.label)).children(f.options.map(([val, label]) =>
        h_flex().id(`gg-rd-${f.key}-${val}`).h(24).gap(8).items_center().cursor_pointer().on_click((_e, cx) => { this.values[f.key] = val; cx.notify(); })
          .child(box(this.values[f.key] === val, true)).child(label)));
    };
    const button = (id, label, bg, fg, border, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(border).bg(bg).text_color(fg).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    return v_flex().id("gg-dialog").size_full().min_h(0).p(18).gap(12).rounded(8).bg(t.popover).text_size(12.5).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); }
        else if (e.key === "enter" && !Object.keys(this.inputs).length) { this.confirm(cx); cx.stop_propagation(); }
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(def.title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child(def.text))
      .child(v_flex().flex_1().min_h(0).gap(8).overflow_y_scrollbar().children(def.fields.map(fieldEl)))
      .when(Boolean(this.error), (e) => e.child(div().max_h(80).overflow_y_scrollbar().text_size(11.5).text_color(t.ansi1).child(this.error)))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("gg-no", "Cancel", t.raised, t.foreground, t.input, () => closeOverlay(p.overlay)))
        .child(button("gg-yes", this.busy ? "Running…" : def.title.replace(/^(Add|Create|Delete|Push|Rename|Reset|Fetch|Stash|Clean|Checkout|Merge|Rebase|Revert|Cherry Pick|Drop|Pull).*$/, "$1") || "Confirm",
          def.danger ? t.ansi1 : t.solid, def.danger ? "#ffffff" : t.solid_foreground, def.danger ? t.ansi1 : t.solid, (_e, cx) => this.confirm(cx))));
  }
}

// A commit's menu starts with its branches and tags, each opening that ref's own menu
// (rows of a virtual list can't take their own clicks, so badges can't).
function menuList(kind, target, ctx, refs) {
  const items = [];
  const names = { head: "Branch", remote: "Remote Branch", tag: "Tag" };
  for (const r of refs ?? []) items.push({ label: `${names[r.type]} ${r.name}  ›`, sub: { kind: r.type, target: r } });
  if (items.length) items.push("-");
  items.push(...menuItems(kind, target, ctx).filter((x) => x === "-" || !x.hidden));
  return items.filter((x, i) => !(x === "-" && (i === 0 || items[i - 1] === "-" || i === items.length - 1)));
}

function openMenuOverlay(kind, target, ctx, repo, refs) {
  const height = menuList(kind, target, ctx, refs).reduce((h, x) => h + (x === "-" ? 9 : 26), 12);
  openOverlay({ mod: "git-graph-vsc", kind: "popup", width: 300, height: Math.min(560, height), props: { menu: kind, target, ctx, repo, refs } });
}

function dialogHeight(a) {
  if (!a) return 200;
  let h = 150 + Math.ceil(a.text.length / 60) * 18;
  for (const f of a.fields) h += f.type === "text" ? 58 : f.type === "check" ? 32 : 22 + f.options.length * 26;
  return Math.min(560, h + 40);
}
