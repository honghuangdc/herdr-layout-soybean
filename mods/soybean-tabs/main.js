// Agentee editor strip: Chrome-like tabs for the window's work tabs.
// Drag a tab onto another to move it; the + sits right after the last tab.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, home, run, openOverlay, theme, window, layout, settings, shared, setShared } from "herdr";

// A working agent's tab: a spinner in the theme's `working` colour.
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// A tab lives in a space, and tab.new from a mod with none open fails ("no
// space yet: make one first"). Every click that wants a tab gets the space it
// needs first: a window with no space still opens a tab.
function ensureSpace() {
  if (!spaces().some((s) => s.active)) run("space.new");
}

// Panes run by a mod carry no program; give the ones we ship a tile by hand.
const MOD_TILES = {
  "space-home": { name: "Home", icon: "mods/space-home/home.svg", tint: true, tile: "#22323a", color: "#9ec8d8" },
  "git-graph-vsc": { name: "Git Graph", icon: "mods/git-graph-vsc/graph.svg", tint: true, tile: "#2d2a3a", color: "#c9a7f5" },
};

export default class Tabs extends View {
  init(props, cx) {
    // Command behind the globe button; the layout passes its machine-local path.
    this.browser = props?.browser ?? "herdr-browser-split";

    this.pressed = null;
    this.hovered = null;
    this.space = undefined;
    this.frame = 0;
    cx.timer.every(200, (cx) => {
      this.followSpace();
      // A working agent's spinner turns only while one is working.
      if ((spaces().find((s) => s.active)?.tabs ?? []).some((x) => x.status === "working")) { this.frame++; cx.notify(); }
    });
  }

  // The right panel (Files, Agents, System) belongs to the window's layout, so
  // it would look the same in every space. Each space keeps its own: shown or
  // not, and which tool; a space that never opened it starts closed.
  followSpace() {
    const sp = spaces();
    const id = sp.find((s) => s.active)?.id ?? null;
    const root = layout(), panel = find(root, "panel"), stack = find(root, "panel-body");
    if (!id || !panel) return;
    const now = { shown: !panel.hidden, active: stack?.active ?? "panel-files" };
    const saved = shared("agentee.panel.bySpace");
    const bySpace = saved && typeof saved === "object" ? { ...saved } : {};
    if (id !== this.space) {
      const first = this.space === undefined;
      this.space = id;
      // On start the window already shows this space as it was left.
      if (first) { if (!bySpace[id]) this.keep(bySpace, id, now, sp); return; }
      const want = bySpace[id] ?? { shown: false, active: now.active };
      if (want.shown) {
        if (!now.shown) run("layout.show", { id: "panel" });
        if (want.active && want.active !== now.active) run("layout.select", { stack: "panel-body", child: want.active });
      } else if (now.shown) run("layout.hide", { id: "panel" });
      return;
    }
    const was = bySpace[id];
    if (!was || was.shown !== now.shown || was.active !== now.active) this.keep(bySpace, id, now, sp);
  }

  keep(bySpace, id, state, sp) {
    bySpace[id] = state;
    // Closed spaces go with the next change.
    for (const key of Object.keys(bySpace)) if (!sp.some((s) => s.id === key)) delete bySpace[key];
    setShared("agentee.panel.bySpace", bySpace);
  }

  nameOf(tab) {
    const p = panes().find(x => x.tab === tab.id && x.program?.agent)?.program ?? panes().find(x => x.tab === tab.id)?.program;
    const name = String(tab?.name ?? "").trim();
    if (!name || /^tb\d+$/.test(name) || /^\d+$/.test(name)) return p?.name ?? "Terminal";
    return name;
  }

  render() {
    const t = theme();
    const ui = shared("agentee.settings")?.tabs ?? {};
    const minW = ui.minWidth ?? 60, maxW = Math.max(minW, ui.maxWidth ?? 200);
    const space = spaces().find(s => s.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action, tip) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
      .on_mouse_down("left", stop).on_click(action).when(Boolean(tip), el => el.tooltip(tip)).child(label);

    // Terminals' program tile inside each pill.
    const tile = (p) => div().relative().flex_none().size(24).rounded(7).border_1().border_color(t.border)
      .bg(p?.tile ?? t.surface).flex().items_center().justify_center()
      .when(Boolean(p?.icon), el => el.child(p.tint ? svg(p.icon).size(13).flex_none().text_color(p.color ?? t.foreground) : image(p.icon).size(13).flex_none()));

    // A space's home tab is furniture: no close button, no middle-click close.
    const fixed = new Set(panes().filter(p => p.mod === "space-home").map(p => p.tab));

    const item = (tab, i) => {
      const on = tab.active, hot = this.hovered === tab.id, pinned = fixed.has(tab.id);
      const label = this.nameOf(tab) || "Tab";
      const program = panes().find(p => p.tab === tab.id && p.program?.agent)?.program ?? panes().find(p => p.tab === tab.id)?.program
        ?? MOD_TILES[panes().find(p => p.tab === tab.id && p.mod)?.mod]; // mod panes carry no program
      // Terminals' pill: a rounded chip on a rounded tray, no accent line or dividers.
      return h_flex().id(`tab-${tab.id}`).h(26).flex_none().max_w(maxW).min_w(minW)
        .pl(5).pr(5).gap(7).items_center()
        .rounded(13).border_1()
        .when(on, el => el.bg(t.raised).border_color(t.border))
        .when(!on, el => el.border_color("#00000000").hover(s => s.bg(t.hover)))
        .text_size(12).text_color(on ? t.foreground : t.muted).cursor_pointer()
        .when(!pinned, el => el.on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); run("tab.close", { id: tab.id }); }))
        .on_hover((hovered, cx) => {
          if (hovered) this.hovered = tab.id;
          else if (this.hovered === tab.id) this.hovered = null;
          cx.notify();
        })
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          if (!pinned) this.pressed = i; // the home tab keeps its place
          if (e.click_count === 2) run("tab.rename", { id: tab.id });
        })
        .on_mouse_up("left", () => {
          const from = this.pressed;
          this.pressed = null;
          if (from !== null && from !== i) {
            const target = space.tabs.findIndex(x => x.id === tab.id) + 1;
            run("tab.move", { id: shown[from].id, index: target });
          } else run("tab.select", { id: tab.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: space.id } } }); })
        .child(tile(program))
        .child(h_flex().flex_1().min_h(0).pl(2).gap(6).items_center()
          .child(div().min_w(0).flex_shrink(1).truncate().child(ui.fullFilenames === false ? label.split(".")[0] : label))
          .when(tab.status === "working", el => el.child(div().flex_none().text_size(12).text_color(t.working).child(SPIN[this.frame % SPIN.length])))
          .when(tab.status === "blocked", el => el.child(div().size(6).flex_none().rounded_full().bg(t.blocked)))
          .when(tab.status === "done", el => el.child(div().size(6).flex_none().rounded_full().bg(t.done)))
          // The close button keeps its place, so tabs don't jump on hover; a
          // pinned tab leaves the same slot empty.
          .child(pinned
            ? div().size(16).flex_none()
            : div().id(`close-${tab.id}`).size(16).flex_none().flex().items_center().justify_center().rounded(3)
              .when(on || hot || ui.closeOnHover === false, el => el.text_color(t.dim).hover(s => s.bg(t.raised).text_color(t.foreground))
                .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: tab.id }); })
                .child(svg("mods/soybean-tabs/icons/close.svg").size(10)))));
    };

    const plus = div().id("tab-new").h(26).w(28).flex_none().flex().items_center().justify_center().rounded(13)
      .bg("#00000000").text_color(t.dim).text_size(18).cursor_pointer()
      .hover((x) => x.bg(t.hover).text_color(t.accent))
      .tooltip("New tab: pick a terminal or an agent")
      .on_mouse_down("left", stop).on_click(() => { ensureSpace(); openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }); })
      .child("+");

    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    const panel = find(root, "panel"), stack = find(root, "panel-body");
    const shownPanel = panel && !panel.hidden ? stack?.active ?? null : null;
    const panelButton = (id, icon, tip) => div().id(`top-${id}`).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .bg(shownPanel === id ? t.raised : "#00000000")
      .text_color(shownPanel === id ? t.accent : t.dim).cursor_pointer()
      .hover((x) => x.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click(() => {
        if (shownPanel === id) { run("layout.hide", { id: "panel" }); return; }
        run("layout.show", { id: "panel" });
        run("layout.select", { stack: "panel-body", child: id });
      })
      .child(svg(`mods/soybean-tabs/icons/${icon}.svg`).size(15));
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / (settings().zoom ?? 1) - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;

    return h_flex().size_full().min_w(0).pl(lightsPadding).pr(8).gap(2).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h(36).p(3).gap(3).items_center().overflow_x_scrollbar()
        .children([...shown.map(item), plus]))
      .child(h_flex().h(31).flex_none().items_center().gap(1)
        .child(panelButton("panel-files", "folder", "Files"))
        .child(panelButton("panel-gh", "github", "GitHub"))
        .child(button("add-phone", svg("mods/soybean-tabs/icons/smartphone.svg").size(15), () => run("mod.open", { name: "add-phone" }), "Add phone"))
        .child(button("open-browser", svg("mods/soybean-tabs/icons/globe.svg").size(15), () => run("pane.split", { direction: "right", argv: [this.browser] }), "Browser in a new pane"))
        .child(button("new-graph-tab", svg("mods/soybean-tabs/icons/graph.svg").size(15), () => run("tab.new", { mod: "git-graph-vsc", name: "Git Graph", props: { tab: true } }), "Git Graph in a new tab"))
      .when(w?.buttons, el => el.child(h_flex().h(31).items_center().gap(2)
        .child(button("minimize", w.platform === "windows" ? svg("mods/soybean-tabs/icons/win-min.svg").size(15) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/soybean-tabs/icons/${w.maximized ? "win-restore" : "win-max"}.svg`).size(15) : "□", () => run("window.maximize")))
        .child(button("close-window", svg("mods/soybean-tabs/icons/win-close.svg").size(15), () => run("window.close"))))));
  }
}
