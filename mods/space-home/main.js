// Space home: the first tab of a new space. Shows where the space lives, its git
// state, the last few commits and the usual next steps, so a fresh space does not
// open on a bare shell. Props from the tab: { space } (the space's id); without it
// the active space is shown, which is also what a re-open of this tab means.
//
// The tab is added by `agentee-spaces` right after `space.new`; that mod also
// closes the terminal the app opened with the space.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, exec, theme, spaces, settings, focused } from "herdr";

const MONO = () => settings()?.font_family ?? "JetBrains Mono";
// The collector ships next to this file; it reads pi, codex and claude's own session stores.
const SESSIONS = 'python3 "$HOME/.config/herdr-app/mods/space-home/sessions.py" "$1"';
const AGENT_COLOR = (t) => ({ pi: t.accent, codex: t.done, claude: t.unknown });
// How each CLI picks a conversation back up by id.
const AGENT_RESUME = { pi: ["pi", "--session"], codex: ["codex", "resume"], claude: ["claude", "--resume"] };

export default class SpaceHome extends View {
  init(p, cx) {
    this.spaceId = p?.space ?? null;
    this.data = { kind: "loading" };
    this.load(cx);
    cx.timer.every(15000, (cx) => this.load(cx));
  }

  space() {
    const all = spaces() ?? [];
    const id = this.spaceId ?? focused()?.space;
    return (id && all.find((s) => s.id === id)) || all.find((s) => s.active) || null;
  }

  load(cx) {
    const s = this.space();
    const cwd = s?.folder;
    if (!cwd) {
      this.data = { kind: "none" };
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => {
      const sh = async (cmd, args) => {
        try {
          const r = await exec(cmd, args, { cwd, on: s.machine ?? null });
          return r.code === 0 ? r.stdout.trim() : null;
        } catch {
          return null;
        }
      };
      const branch = await sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
      const status = branch ? await sh("git", ["status", "--porcelain"]) : null;
      const log = branch ? await sh("git", ["log", "-6", "--pretty=format:%h%x1f%cr%x1f%s"]) : null;
      const counts = branch ? await sh("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) : null;
      const files = branch ? null : await sh("ls", ["-1", cwd]);
      const sessions = await sh("sh", ["-c", SESSIONS, "sh", cwd]);
      const [ahead, behind] = counts ? counts.split(/\s+/).map(Number) : [];
      this.data = {
        kind: branch ? "repo" : files === null ? "none" : "folder",
        cwd,
        branch,
        dirty: status ? status.split("\n").filter(Boolean).length : 0,
        ahead: ahead || 0,
        behind: behind || 0,
        commits: (log ?? "").split("\n").filter(Boolean).map((l) => l.split("\x1f")),
        entries: (files ?? "").split("\n").filter(Boolean).slice(0, 14),
        sessions: (() => { try { return JSON.parse(sessions) ?? []; } catch { return []; } })(),
      };
      cx.notify();
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

  render() {
    const t = theme();
    const d = this.data;
    const s = this.space();
    const panel = (child) => {
      run("layout.show", { id: "panel" });
      run("layout.select", { stack: "panel-body", child });
    };
    const label = (text) => div().text_size(10).text_color(t.dim).font_semibold().child(text.toUpperCase());
    const section = (title, body) => v_flex().gap(7).child(label(title)).child(body);

    return v_flex().id("space-home").size_full().min_h(0).bg(t.background)
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(20).max_w(780).w_full()

        .child(h_flex().gap(9).items_center()
          .child(svg("mods/space-home/home.svg").size(14).flex_none().text_color(t.dim))
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child(s?.name || "Space"))
          .when(d.kind === "repo", (el) => el.child(this.pill(t, d.branch)
            .child(svg("mods/space-home/branch.svg").size(10).flex_none().text_color(t.dim))))
          .child(div().flex_1().min_w(0))
          .child(div().font_family(MONO()).text_size(11).text_color(t.dim).truncate().child(d.cwd ?? "")))

        .when(d.kind === "repo", (el) => el
          .child(section("Working tree", h_flex().gap(6).flex_wrap()
            .child(this.pill(t, d.dirty ? `${d.dirty} uncommitted` : "clean", d.dirty ? t.blocked : t.done))
            .when(d.ahead > 0, (x) => x.child(this.pill(t, `${d.ahead} ahead`)))
            .when(d.behind > 0, (x) => x.child(this.pill(t, `${d.behind} behind`)))))
          .child(section("Recent commits", v_flex().gap(1)
            .children(d.commits.map(([sha, when, subject]) => h_flex().w_full().h(26).px(6).gap(10).items_center().rounded(4)
              .text_size(12).whitespace_nowrap().hover((x) => x.bg(t.hover))
              .child(div().font_family(MONO()).text_size(11).text_color(t.dim).flex_none().w(56).child(sha))
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(subject))
              .child(div().flex_none().text_color(t.dim).text_size(11).child(when))))
            .when(d.commits.length === 0, (x) => x.child(div().text_size(12).text_color(t.muted).child("No commits yet."))))))

        .when(d.kind === "folder", (el) => el
          .child(section("Not a git repository", v_flex().gap(1).children(d.entries.map((name) =>
            h_flex().w_full().h(24).px(6).gap(8).items_center().rounded(4).text_size(12).hover((x) => x.bg(t.hover))
              .child(svg("mods/space-home/file.svg").size(11).flex_none().text_color(t.dim))
              .child(div().font_family(MONO()).text_color(t.muted).truncate().child(name)))))))

        .when(d.kind === "none", (el) => el.child(div().text_size(12).text_color(t.muted).child("No folder for this space.")))

        .when((d.sessions ?? []).length > 0, (el) => el.child(section("Agent sessions", v_flex().gap(1)
          .children(d.sessions.map((x) => h_flex().w_full().h(26).px(6).gap(10).items_center().rounded(4)
            .text_size(12).whitespace_nowrap().hover((y) => y.bg(t.hover))
            .on_click(() => this.resume(x))
            .child(div().flex_none().w(46).text_size(10).font_semibold()
              .text_color(AGENT_COLOR(t)[x.agent] ?? t.muted).child(x.agent))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.title))
            .child(div().flex_none().text_color(t.dim).text_size(11).child(this.ago(x.ms))))))))

        .child(section("Start", h_flex().gap(8).flex_wrap()
          .child(this.action(t, "home-terminal", "Terminal", "terminal", () => run("tab.new", {})))
          .child(this.action(t, "home-files", "Files", "files", () => panel("panel-files")))
          .child(this.action(t, "home-github", "GitHub", "github", () => panel("panel-gh")))
          .child(this.action(t, "home-graph", "Git Graph", "graph",
            () => run("tab.new", { mod: "git-graph-vsc", name: "Git Graph", props: { tab: true } }))))));
  }
}
