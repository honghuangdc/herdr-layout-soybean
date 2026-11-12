// Space home: the first tab of a new space. Shows where the space lives, its git
// state, the last few commits and the usual next steps, so a fresh space does not
// open on a bare shell. Props from the tab: { space } (the space's id); without it
// the active space is shown, which is also what a re-open of this tab means.
//
// The tab is added by `agentee-spaces` right after `space.new`; that mod also
// closes the terminal the app opened with the space.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, exec, theme, spaces, settings } from "herdr";

const MONO = () => settings()?.font_family ?? "JetBrains Mono";

export default class SpaceHome extends View {
  init(p, cx) {
    this.spaceId = p?.space ?? null;
    this.data = { kind: "loading" };
    this.load(cx);
    cx.timer.every(15000, (cx) => this.load(cx));
  }

  space() {
    const all = spaces() ?? [];
    return (this.spaceId && all.find((s) => s.id === this.spaceId)) || all.find((s) => s.active) || null;
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
      };
      cx.notify();
    });
  }

  action(t, id, label, icon, fn) {
    return h_flex().id(id).h(26).flex_none().gap(6).px(9).items_center().rounded(6).text_size(12)
      .bg(t.raised).border_1().border_color(t.border).text_color(t.foreground)
      .hover((s) => s.bg(t.hover).border_color(t.accent))
      .on_click(fn)
      .child(svg(`mods/space-home/${icon}.svg`).size(13).flex_none().text_color(t.muted))
      .child(label);
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

    return v_flex().size_full().min_h(0).items_center().overflow_y_scrollbar().p(34).gap(20)
      .child(v_flex().w_full().max_w(680).gap(18)
        .child(v_flex().gap(6)
          .child(h_flex().gap(10).items_center()
            .child(div().text_size(20).font_semibold().text_color(t.foreground).child(s?.name || "Space"))
            .when(d.kind === "repo", (el) => el.child(h_flex().h(20).gap(4).px(7).items_center().rounded(10)
              .bg(t.raised).text_size(11).text_color(t.muted)
              .child(svg("mods/space-home/branch.svg").size(10).flex_none())
              .child(d.branch))))
          .child(div().font_family(MONO()).text_size(12).text_color(t.muted).truncate().child(d.cwd ?? "")))

        .when(d.kind === "repo", (el) => el
          .child(v_flex().gap(6)
            .child(label("Working tree"))
            .child(h_flex().gap(14).items_center().text_size(12)
              .child(div().text_color(d.dirty ? t.blocked : t.done).child(d.dirty ? `${d.dirty} uncommitted` : "clean"))
              .when(d.ahead > 0, (x) => x.child(div().text_color(t.muted).child(`${d.ahead} ahead`)))
              .when(d.behind > 0, (x) => x.child(div().text_color(t.muted).child(`${d.behind} behind`)))))
          .child(v_flex().gap(3)
            .child(label("Recent commits"))
            .children(d.commits.map(([sha, when, subject]) => h_flex().gap(10).items_center().text_size(12).py(2).whitespace_nowrap()
              .child(div().font_family(MONO()).text_size(11).text_color(t.dim).flex_none().w(56).child(sha))
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(subject))
              .child(div().flex_none().text_color(t.dim).text_size(11).child(when))))))

        .when(d.kind === "folder", (el) => el
          .child(v_flex().gap(6)
            .child(label("Not a git repository"))
            .child(v_flex().gap(2).children(d.entries.map((name) =>
              h_flex().gap(8).items_center().text_size(12)
                .child(svg("mods/space-home/file.svg").size(11).flex_none().text_color(t.dim))
                .child(div().font_family(MONO()).text_color(t.muted).child(name)))))))

        .when(d.kind === "none", (el) => el.child(div().text_size(12).text_color(t.muted).child("No folder for this space.")))

        .child(v_flex().gap(6)
          .child(label("Start"))
          .child(h_flex().gap(8).flex_wrap()
            .child(this.action(t, "home-terminal", "Terminal", "terminal", () => run("tab.new", {})))
            .child(this.action(t, "home-files", "Files", "files", () => panel("panel-files")))
            .child(this.action(t, "home-github", "GitHub", "github", () => panel("panel-gh")))
            .child(this.action(t, "home-graph", "Git graph", "graph",
              () => run("tab.new", { mod: "git-graph-vsc", name: "Git Graph", props: { tab: true } }))))));
  }
}
