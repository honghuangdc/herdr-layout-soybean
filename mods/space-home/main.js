// Space home: the first tab of a new space. Shows where the space lives, its git
// state, the last few commits and the usual next steps, so a fresh space does not
// open on a bare shell. Props from the tab: { space } (the space's id); without it
// the active space is shown, which is also what a re-open of this tab means.
//
// The tab is added by `agentee-spaces` right after `space.new`; that mod also
// closes the terminal the app opened with the space.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, exec, theme, spaces, settings, shared, setShared } from "herdr";

const MONO = () => settings()?.font_family ?? "JetBrains Mono";
// The collector ships next to this file; it reads pi, codex and claude's own session stores.
// One shell call answers both questions; two execs made the page wait twice.
const LOAD = 'printf "%s\\n" "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"; python3 "$HOME/.config/herdr-app/mods/space-home/sessions.py" "$1"';
// A space switch reloads this mod, so a module Map would split across instances.
const CACHE_KEY = "space.home.cache";
const cacheAll = () => shared(CACHE_KEY) ?? {};
const cacheGet = (key) => cacheAll()[key] ?? null;
const cacheSet = (key, value) => {
  const all = { ...cacheAll() };
  all[key] = { ...(all[key] ?? {}), ...value, at: Date.now() };
  setShared(CACHE_KEY, all);
};
const INFLIGHT = new Set();
const AGENT_COLOR = (t) => ({ pi: t.accent, codex: t.done, claude: t.unknown });
// How each CLI picks a conversation back up by id.
const AGENT_RESUME = { pi: ["pi", "--session"], codex: ["codex", "resume"], claude: ["claude", "--resume"] };

export default class SpaceHome extends View {
  init(p, cx) {
    this.spaceId = p?.space ?? null;
    this.picking = false;
    this.load(cx);
    // A space switch re-renders this pane without rebuilding it; look again there,
    // then every 15s while the space stays on screen.
    cx.timer.every(250, (cx) => {
      const s = this.space();
      const key = this.key(s);
      const hit = key && cacheGet(key);
      if (key && !INFLIGHT.has(key) && (!hit || Date.now() - hit.at > 15000)) this.load(cx);
    });
  }

  space() {
    const all = spaces() ?? [];
    const id = this.spaceId;
    return (id && all.find((s) => s.id === id)) || all.find((s) => s.active) || null;
  }

  key(s) {
    return s?.folder ? JSON.stringify([s.machine ?? null, s.folder]) : null;
  }

  load(cx) {
    const s = this.space();
    const key = this.key(s);
    if (!key || INFLIGHT.has(key)) return;
    const [on, cwd] = JSON.parse(key);
    INFLIGHT.add(key);
    cacheSet(key, {});
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", LOAD, "sh", cwd], { cwd, on });
        if (r.code !== 0) return;
        const [branch, ...lines] = r.stdout.split("\n");
        const sessions = (() => { try { return JSON.parse(lines.join("\n").trim()) ?? []; } catch { return []; } })();
        cacheSet(key, { branch: branch || null, sessions });
        cx.notify();
      } catch {} finally { INFLIGHT.delete(key); }
    });
  }

  action(t, id, label, icon, fn) {
    return h_flex().id(id).h(26).flex_none().gap(6).px(9).items_center().rounded(6).text_size(12)
      .border_1().border_color(t.border).text_color(t.muted)
      .hover((s) => s.bg(t.raised).border_color(t.border_strong ?? t.border).text_color(t.foreground))
      .on_click(fn)
      .child(svg(`mods/space-home/${icon}.svg`).size(13).flex_none())
      .child(label);
  }

  // A small rounded chip, the shape the panels use for counts and refs.
  pill(t, text, color) {
    return h_flex().h(20).flex_none().gap(5).px(8).items_center().rounded(6).text_size(11)
      .bg(t.surface).border_1().border_color(t.border).text_color(color ?? t.muted)
      .child(text);
  }

  // Retarget the space by picking a folder in the system panel. The folder arrives
  // as a new space (`agentee-spaces` does the swap), because no command repoints one.
  pickFolder(cx) {
    const s = this.space();
    const at = s?.folder;
    if (!s || !at || this.picking) return;
    this.picking = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const quoted = at.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const r = await exec("osascript", ["-e",
        `POSIX path of (choose folder with prompt "Move this space here" default location POSIX file "${quoted}")`],
        { cwd: at, on: s.machine ?? null, timeout: 600000 }).catch(() => null);
      this.picking = false;
      const folder = r?.code === 0 ? (r.stdout ?? "").trim().replace(/\/+$/, "") : "";
      if (folder) setShared("space.home.move", { id: s.id, folder, at: Date.now() });
      cx.notify();
    });
  }

  folderRow(t) {
    const s = this.space();
    const want = shared("space.home.move");
    const moving = want?.id && want.id === s?.id;
    return h_flex().flex_1().min_w(0).gap(8).items_center().justify_end()
      .child(div().font_family(MONO()).text_size(11).text_color(t.dim).truncate()
        .child(moving ? `${s?.folder ?? ""} → ${want.folder}` : (s?.folder ?? "")))
      // A space on another machine keeps its folder: the panel would open there.
      .when(!s?.machine, (el) => el.child(h_flex().flex_none().h(20).px(7).items_center().rounded(6).text_size(10)
        .text_color(this.picking ? t.dim : t.muted).border_1().border_color(t.border)
        .when(!this.picking, (x) => x.hover((y) => y.bg(t.raised).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.pickFolder(cx); }))
        .child(this.picking ? "choosing…" : "Change")));
  }

  // Open the conversation in its own agent, in the space it belongs to.
  resume(x) {
    const s = this.space();
    const cli = AGENT_RESUME[x.agent];
    if (!cli || !x.id) return;
    run("tab.new", { space: s?.id, name: x.agent, argv: [...cli, x.id] });
  }

  // "3m", "5h", "2d" — the shape git's own %cr uses.
  ago(ms) {
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 60) return `${min}m`;
    if (min < 1440) return `${Math.round(min / 60)}h`;
    return `${Math.round(min / 1440)}d`;
  }

  // A bordered card, the shape the side panels wear around a list.
  card(t, title, count, body) {
    return v_flex().w_full().rounded(8).overflow_hidden().bg(t.surface)
      .border_1().border_color(t.border)
      .child(h_flex().h(30).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(title))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(String(count))))
      .child(v_flex().p(4).gap(1).child(body));
  }

  render() {
    const t = theme();
    const s = this.space();
    const key = this.key(s);
    const d = (key && cacheGet(key)) ?? {};
    const sessions = d.sessions ?? [];
    const panel = (child) => {
      run("layout.show", { id: "panel" });
      run("layout.select", { stack: "panel-body", child });
    };
    const section = (title, body) => v_flex().gap(7)
      .child(div().text_size(10).text_color(t.dim).font_semibold().child(title.toUpperCase()))
      .child(body);

    return v_flex().id("space-home").size_full().min_h(0).bg(t.background)
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(18).max_w(820).w_full()

        .child(h_flex().gap(9).items_center()
          .child(svg("mods/space-home/home.svg").size(14).flex_none().text_color(t.dim))
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child(s?.name || "Space"))
          .when(d.branch, (el) => el.child(this.pill(t, d.branch)
            .child(svg("mods/space-home/branch.svg").size(10).flex_none().text_color(t.dim))))
          .child(this.folderRow(t)))

        .child(this.card(t, "Agent sessions", sessions.length, sessions.length
          ? v_flex().max_h(280).overflow_y_scrollbar().children(sessions.map((x) => h_flex().w_full().h(28).flex_none().px(8).gap(10).items_center().rounded(5)
              .text_size(12).whitespace_nowrap().hover((y) => y.bg(t.raised))
              .on_click(() => this.resume(x))
              .child(div().flex_none().w(46).text_size(10).font_semibold()
                .text_color(AGENT_COLOR(t)[x.agent] ?? t.muted).child(x.agent))
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.title))
              .child(div().flex_none().text_color(t.dim).text_size(11).child(this.ago(x.ms)))))
          : div().p(8).text_size(12).text_color(t.muted).child("No conversations in this folder yet.")))

        .child(section("Start", h_flex().gap(8).flex_wrap()
          .child(this.action(t, "home-terminal", "Terminal", "terminal", () => run("tab.new", {})))
          .child(this.action(t, "home-files", "Files", "files", () => panel("panel-files")))
          .child(this.action(t, "home-github", "GitHub", "github", () => panel("panel-gh")))
          .child(this.action(t, "home-graph", "Git Graph", "graph",
            () => run("tab.new", { mod: "git-graph-vsc", name: "Git Graph", props: { tab: true } }))))));
  }
}
