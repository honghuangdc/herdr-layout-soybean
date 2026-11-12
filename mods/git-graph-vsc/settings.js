// Repository Settings, as Git Graph's: General (name, stashes, tags, reflogs, first parent),
// User Details (user.name / user.email in this repo's config) and Remote Configuration.
// Opened as a dialog: props { settings: true, repo: { root, on } }.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";
import { git } from "./git.js";

const ICON = (n) => `mods/git-graph-vsc/${n}.svg`;
const basename = (p) => p.replace(/\/+$/, "").split("/").pop();

export function initSettings(view, cx, helpers) {
  view.h = helpers;
  view.st = { loading: true, user: {}, remotes: [], editName: false, editUser: false, editRemote: null, adding: false, confirm: null, error: null, busy: false };
  const input = (placeholder) => {
    const s = InputState.new({ placeholder });
    s.on("change", (_e, cx) => cx.notify());
    return s;
  };
  view.inName = input("Repository name"); view.inUser = input("User name"); view.inEmail = input("User email");
  view.inRName = input("Remote name"); view.inFetch = input("Fetch URL"); view.inPush = input("Push URL (optional)");
  view.handle.focus();
  loadSettings(view, cx);
}

function loadSettings(view, cx) {
  const repo = props().repo;
  cx.spawn(async (cx) => {
    try {
      const get = async (key) => { try { return (await git(repo, ["config", "--get", key])).trim(); } catch { return ""; } };
      const [name, email, rv] = await Promise.all([get("user.name"), get("user.email"), git(repo, ["remote", "-v"])]);
      const remotes = {};
      for (const line of rv.split("\n")) {
        const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
        if (m) (remotes[m[1]] ??= { name: m[1] })[m[3]] = m[2];
      }
      view.st.user = { name, email }; view.st.remotes = Object.values(remotes); view.st.error = null;
    } catch (e) { view.st.error = String(e.message ?? e); }
    view.st.loading = false; cx.notify();
  });
}

// tolerant: a step that fails (e.g. unsetting a key the repo doesn't set) doesn't stop the rest.
function runGit(view, cx, steps, after, tolerant) {
  const repo = props().repo;
  if (view.st.busy) return;
  view.st.busy = true; view.st.error = null; cx.notify();
  cx.spawn(async (cx) => {
    try {
      for (const s of steps) {
        try { await git(repo, s, { write: true, timeout: 120000 }); } catch (e) { if (!tolerant) throw e; }
      }
      after?.(); view.h.bump();
    }
    catch (e) { view.st.error = String(e.message ?? e); }
    view.st.busy = false; loadSettings(view, cx);
  });
}

export function renderSettings(view, cx) {
  const t = theme(), p = props(), st = view.st, root = p.repo.root, cfg = view.h.cfgOf(root);
  const section = (title) => div().w_full().pt(14).pb(8).border_t(1).border_color(t.border).flex().justify_center().text_size(14).font_bold().child(title);
  const icon = (id, name, tip, onClick) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => onClick(cx))
    .child(name.length === 1 ? div().text_size(13).child(name) : svg(ICON(name)).size(14));
  const field = (state) => div().flex_1().min_w(0).h(28).px(8).flex().items_center().rounded(5).border_1().border_color(t.accent).bg(t.background).child(Input.new(state).h_full().text_size(12.5).text_color(t.foreground));
  const button = (id, label, primary, onClick, danger) => h_flex().id(id).h(28).px(12).items_center().rounded(6).cursor_pointer().text_size(12)
    .border_1().border_color(danger ? t.ansi1 : primary ? t.solid : t.input).bg(danger ? t.ansi1 : primary ? t.solid : t.raised).text_color(danger ? "#ffffff" : primary ? t.solid_foreground : t.foreground)
    .hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)).child(label);
  const check = (id, label, on, onClick) => h_flex().id(id).h(26).gap(8).items_center().cursor_pointer().on_click(() => onClick())
    .child(div().size(16).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background).flex().items_center().justify_center()
      .when(on, (e) => e.child(div().text_size(11).text_color(t.accent_foreground).child("✓"))))
    .child(label);
  const row = (k, v, edit) => h_flex().w_full().h(34).px(8).gap(8).items_center().border_b(1).border_color(t.border).child(div().w(120).flex_none().child(k)).child(div().flex_1().min_w(0).truncate().child(v)).when(Boolean(edit), (e) => e.child(edit));

  // ---- General
  const general = v_flex().w_full().gap(2)
    .child(st.editName
      ? h_flex().w_full().h(40).px(8).gap(8).items_center().border_b(1).border_color(t.border).child(div().w(120).flex_none().child("Name:")).child(field(view.inName))
        .child(button("gg-s-name-save", "Save", true, (cx) => { view.h.setCfg(root, { name: view.inName.value().trim() || null }); st.editName = false; cx.notify(); }))
        .child(button("gg-s-name-cancel", "Cancel", false, (cx) => { st.editName = false; cx.notify(); }))
      : row("Name:", cfg.name || basename(root), icon("gg-s-name-edit", "✎", "Edit name", (cx) => { view.inName.set_value(cfg.name || basename(root)); st.editName = true; view.inName.focus(); cx.notify(); })))
    .child(row("Initial Branches:", cfg.branches?.length ? cfg.branches.join(", ") : "Show All", null))
    .child(div().h(6))
    .child(check("gg-s-stashes", "Show Stashes", cfg.stashes, () => view.h.setCfg(root, { stashes: !cfg.stashes })))
    .child(check("gg-s-tags", "Show Tags", cfg.tags, () => view.h.setCfg(root, { tags: !cfg.tags })))
    .child(check("gg-s-reflog", "Include commits only mentioned by reflogs", cfg.reflog, () => view.h.setCfg(root, { reflog: !cfg.reflog })))
    .child(check("gg-s-first", "Only follow the first parent of commits", cfg.firstParent, () => view.h.setCfg(root, { firstParent: !cfg.firstParent })));

  // ---- User Details
  const user = st.editUser
    ? v_flex().w_full().gap(6)
      .child(h_flex().gap(8).items_center().child(div().w(100).child("User Name:")).child(field(view.inUser)))
      .child(h_flex().gap(8).items_center().child(div().w(100).child("User Email:")).child(field(view.inEmail)))
      .child(h_flex().gap(8).justify_center().pt(4)
        .child(button("gg-s-user-save", "Save", true, (cx) => {
          const n = view.inUser.value().trim(), e = view.inEmail.value().trim();
          runGit(view, cx, [...(n ? [["config", "user.name", n]] : []), ...(e ? [["config", "user.email", e]] : [])], () => { st.editUser = false; });
        }))
        .child(button("gg-s-user-cancel", "Cancel", false, (cx) => { st.editUser = false; cx.notify(); })))
    : v_flex().w_full().gap(4)
      .child(h_flex().gap(8).child(div().w(100).child("User Name:")).child(div().text_color(st.user.name ? t.foreground : t.dim).child(st.user.name || "Not set")))
      .child(h_flex().gap(8).child(div().w(100).child("User Email:")).child(div().text_color(st.user.email ? t.foreground : t.dim).child(st.user.email || "Not set")))
      .child(h_flex().gap(16).justify_center().pt(6)
        .child(h_flex().id("gg-s-user-edit").gap(5).items_center().cursor_pointer().text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { view.inUser.set_value(st.user.name ?? ""); view.inEmail.set_value(st.user.email ?? ""); st.editUser = true; view.inUser.focus(); cx.notify(); }).child("✎  Edit"))
        .child(h_flex().id("gg-s-user-remove").gap(5).items_center().cursor_pointer().text_color(t.muted).hover((s) => s.text_color(t.foreground)).tooltip("Remove from this repository's config")
          .on_click((_e, cx) => runGit(view, cx, [["config", "--local", "--unset-all", "user.name"], ["config", "--local", "--unset-all", "user.email"]], null, true)).child("✕  Remove")));

  // ---- Remotes
  const remoteRows = st.remotes.map((r) => {
    if (st.editRemote === r.name) return v_flex().w_full().gap(6).py(6).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center().child(div().w(70).child("Name")).child(field(view.inRName)))
      .child(h_flex().gap(8).items_center().child(div().w(70).child("Fetch")).child(field(view.inFetch)))
      .child(h_flex().gap(8).items_center().child(div().w(70).child("Push")).child(field(view.inPush)))
      .child(h_flex().gap(8).justify_center()
        .child(button(`gg-s-r-save-${r.name}`, "Save", true, (cx) => {
          const name = view.inRName.value().trim() || r.name, fetch = view.inFetch.value().trim(), push = view.inPush.value().trim();
          const steps = [];
          if (name !== r.name) steps.push(["remote", "rename", r.name, name]);
          if (fetch && fetch !== r.fetch) steps.push(["remote", "set-url", name, fetch]);
          if (push && push !== r.push) steps.push(["remote", "set-url", "--push", name, push]);
          runGit(view, cx, steps, () => { st.editRemote = null; });
        }))
        .child(button(`gg-s-r-cancel-${r.name}`, "Cancel", false, (cx) => { st.editRemote = null; cx.notify(); })));
    if (st.confirm === r.name) return h_flex().w_full().h(40).gap(8).items_center().justify_center().border_b(1).border_color(t.border)
      .child(div().child(`Delete remote ${r.name}?`))
      .child(button(`gg-s-r-del-${r.name}`, "Delete", false, (cx) => runGit(view, cx, [["remote", "remove", r.name]], () => { st.confirm = null; }), true))
      .child(button(`gg-s-r-keep-${r.name}`, "Cancel", false, (cx) => { st.confirm = null; cx.notify(); }));
    const url = (u) => div().min_w(0).truncate().tooltip(u ?? "").child(u ?? "—");
    return h_flex().w_full().py(4).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().w(80).flex_none().truncate().child(r.name))
      .child(v_flex().flex_1().min_w(0).gap(2).child(url(r.fetch)).child(url(r.push)))
      .child(v_flex().w(48).flex_none().gap(2).text_color(t.muted).child("Fetch").child("Push"))
      .child(v_flex().w(56).flex_none().gap(2)
        .child(h_flex().gap(2).child(icon(`gg-s-r-fetch-${r.name}`, "fetch", `Fetch from ${r.name}`, (cx) => runGit(view, cx, [["fetch", "--prune", r.name]]))))
        .child(h_flex().gap(2)
          .child(icon(`gg-s-r-edit-${r.name}`, "✎", "Edit remote", (cx) => { view.inRName.set_value(r.name); view.inFetch.set_value(r.fetch ?? ""); view.inPush.set_value(r.push ?? ""); st.editRemote = r.name; cx.notify(); }))
          .child(icon(`gg-s-r-delete-${r.name}`, "x", "Delete remote", (cx) => { st.confirm = r.name; cx.notify(); }))));
  });
  const adding = st.adding
    ? v_flex().w_full().gap(6).pt(6)
      .child(h_flex().gap(8).items_center().child(div().w(70).child("Name")).child(field(view.inRName)))
      .child(h_flex().gap(8).items_center().child(div().w(70).child("Fetch")).child(field(view.inFetch)))
      .child(h_flex().gap(8).items_center().child(div().w(70).child("Push")).child(field(view.inPush)))
      .child(h_flex().gap(8).justify_center()
        .child(button("gg-s-r-add-save", "Add Remote", true, (cx) => {
          const name = view.inRName.value().trim(), fetch = view.inFetch.value().trim(), push = view.inPush.value().trim();
          if (!name || !fetch) { st.error = "Name and fetch URL are required"; cx.notify(); return; }
          runGit(view, cx, [["remote", "add", name, fetch], ...(push ? [["remote", "set-url", "--push", name, push]] : [])], () => { st.adding = false; });
        }))
        .child(button("gg-s-r-add-cancel", "Cancel", false, (cx) => { st.adding = false; cx.notify(); })))
    : h_flex().w_full().pt(8).justify_center().child(h_flex().id("gg-s-r-add").gap(6).items_center().cursor_pointer().text_color(t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { view.inRName.set_value(""); view.inFetch.set_value(""); view.inPush.set_value(""); st.adding = true; view.inRName.focus(); cx.notify(); }).child("+  Add Remote"));
  const remotes = v_flex().w_full()
    .child(h_flex().w_full().h(28).gap(6).items_center().border_b(1).border_color(t.border).font_bold()
      .child(div().w(80).child("Remote")).child(div().flex_1().flex().justify_center().child("URL")).child(div().w(48).child("Type")).child(div().w(56).child("Action")))
    .children(remoteRows)
    .when(!st.remotes.length && !st.loading, (e) => e.child(div().py(8).text_color(t.dim).child("No remotes")))
    .child(adding);

  return v_flex().id("gg-settings").size_full().min_h(0).bg(t.popover).text_size(12.5).text_color(t.foreground).track_focus(view.handle)
    .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
    .child(h_flex().h(48).flex_none().px(16).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1()).child(div().text_size(16).font_bold().child("Repository Settings")).child(div().flex_1())
      .child(icon("gg-s-close", "x", "Close", () => closeOverlay(p.overlay))))
    .child(v_flex().id("gg-settings-body").flex_1().min_h(0).overflow_y_scroll().px(18).pb(16)
      .child(div().w_full().pt(12).pb(8).flex().justify_center().text_size(14).font_bold().child("General"))
      .child(general)
      .child(div().h(8)).child(section("User Details")).child(user)
      .child(div().h(8)).child(section("Remote Configuration")).child(remotes)
      .when(Boolean(st.error), (e) => e.child(div().pt(10).text_size(11.5).text_color(t.ansi1).child(st.error)))
      .when(st.busy || st.loading, (e) => e.child(div().pt(10).text_size(11.5).text_color(t.dim).child(st.loading ? "Loading…" : "Running…"))));
}
