import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, openOverlay, closeOverlay } from "herdr";
import { primer, glyph, spinner, ago, issueState, prState, labelChip, button, blankslate, under } from "./ui.js";
import { load } from "./gh.js";
import { STAGES, columns, ref, changesOf, cleanupOf } from "./work.js";
import { setWork, liveAgents, joinAgent, showChanges, cleanUp } from "./actions.js";

const PAGE = 30, SYNC = 60000;
const TONE = { todo: "neutral", doing: "attention", review: "link", done: "done" };

// The repository's work as a GitLab-style board, in a dialog: { repo, me, locals } from the panel.
// Open issues and pull requests, plus the last closed issues; a card's stage comes from work.js.
export class Board {
  constructor({ repo, me, locals }, overlay, cx) {
    Object.assign(this, { repo, me, locals: locals ?? {}, overlay, items: null, error: null, shown: {} });
    this.changedAt = shared("github.changed")?.at;
    this.load(cx);
    cx.timer.every(SYNC, (cx) => this.load(cx));
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => { // load() also runs from render, where cx.notify() is refused
      cx.notify();
      try {
        const scope = { repo: this.repo };
        const [open, closed, prs] = await Promise.all([
          load.issues(scope, { state: "open" }),
          load.issues(scope, { state: "closed", limit: 20 }),
          load.prs(scope, { state: "open" }),
        ]);
        this.items = [...open, ...closed, ...prs]; this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  open({ item, kind }) {
    openOverlay({ mod: "github", kind: "dialog", width: 0.88, height: 0.92, props: { item: { kind, repo: item.repo, number: item.number, me: this.me, locals: this.locals, data: kind === "pr" ? null : item } } });
  }

  card(c, t) {
    const p = primer(t), { item, kind, stage, why, agent } = c, key = ref(item);
    const [g, color] = kind === "pr" ? prState(item, p) : issueState(item, p);
    const changes = changesOf(this.work[key], c), cleanup = cleanupOf(this.work[key], c, this.agentsNow);
    const tone = agent?.status === "blocked" ? p.closed : p[TONE[stage]];
    return v_flex().id(`card-${key}`).flex_none().p(10).gap(6).rounded(8).bg(t.background).border_1().border_color(t.border).cursor_pointer()
      .hover((s) => s.border_color(p.link))
      .on_click(() => this.open(c))
      .on_mouse_down("right", () => stageMenu(key, "pointer"))
      .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
        .child(glyph(g, 14, color)).child(div().child(`#${item.number}`))
        .when(kind === "pr", (e) => e.child(div().truncate().font_family("JetBrains Mono").text_size(11).child(item.headRefName)))
        .child(div().flex_1())
        .when(Boolean(agent), (e) => e.child(button(`join-${key}`, "Join", t, () => joinAgent(agent), { icon: "agent", invisible: true, small: true, tooltip: "Go to the agent's tab" })))
        .when(Boolean(changes), (e) => e.child(button(`changes-${key}`, "Changes", t, (_e, cx) => { cx.stop_propagation(); showChanges(changes); }, { icon: "diff", invisible: true, small: true, tooltip: "Review the agent’s commits" })))
        .when(cleanup, (e) => e.child(button(`cleanup-${key}`, "Clean up", t, (_e, cx) => { cx.stop_propagation(); cleanUp(key, this.work[key]); }, { icon: "close", invisible: true, small: true, tooltip: "Remove the agent’s worktree, and its branch if merged" })))
        .child(button(`move-${key}`, "", t, () => stageMenu(key), { icon: "chevron-down", invisible: true, small: true, tooltip: "Move to…" })))
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(item.title))
      .when(item.labels?.length > 0, (e) => e.child(h_flex().gap(4).flex_wrap().children(item.labels.slice(0, 3).map((l) => labelChip(l, t, true)))))
      .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
        .when(Boolean(why) && stage !== "todo", (e) => e.child(h_flex().gap(4).items_center().text_color(tone).font_semibold()
          .child(agent?.status === "working" ? spinner(10, tone) : glyph(agent ? "agent" : stage === "done" ? "check" : stage === "review" ? "pr-open" : "clock", 10, tone)).child(why)))
        .child(div().flex_1())
        .when(item.assignees?.length > 0, (e) => e.child(div().truncate().child(item.assignees.map((a) => a.login).join(", "))))
        .child(div().flex_none().child(ago(item.updatedAt))));
  }

  column([k, label], cards, t) {
    const p = primer(t), n = this.shown[k] ?? PAGE;
    return v_flex().flex_1().min_w(0).h_full().rounded(10).bg(t.raised).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().flex_none().h(40).px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().size(8).rounded(4).bg(p[TONE[k]]))
        .child(div().text_size(13).font_semibold().child(label))
        .child(div().text_size(12).text_color(t.muted).child(String(cards.length))))
      .child(v_flex().id(`col-${k}`).flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8)
        .children(cards.slice(0, n).map((c) => this.card(c, t)))
        .when(cards.length > n, (e) => e.child(h_flex().flex_none().justify_center().py(4)
          .child(button(`more-${k}`, `Show ${Math.min(PAGE, cards.length - n)} more · ${cards.length - n} left`, t, (_e, cx) => { this.shown[k] = n + PAGE; cx.notify(); }, { small: true }))))
        .when(cards.length === 0, (e) => e.child(div().py(16).text_size(12).text_color(t.dim).text_center().child("Nothing here"))));
  }

  render(cx) {
    const t = theme();
    const changed = shared("github.changed");
    if (changed?.at && changed.at !== this.changedAt) { this.changedAt = changed.at; this.load(cx); }
    const frame = v_flex().id("board").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().h(52).px(20).gap(8).items_center().border_b(1).border_color(t.border)
        .child(glyph("project", 16, t.muted)).child(div().text_size(15).font_semibold().child(this.repo)).child(div().text_size(13).text_color(t.muted).child("Board"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(primer(t).closed).child(this.items && this.error ? this.error : ""))
        .child(div().text_size(11.5).text_color(t.dim).child("Right-click a card to move it"))
        .child(this.loading ? div().px(7).child(spinner(14, t.muted)) : button("refresh", "", t, (_e, cx) => this.load(cx), { icon: "refresh", invisible: true, tooltip: "Refresh" }))
        .child(button("close-board", "", t, () => closeOverlay(this.overlay), { icon: "close", invisible: true, tooltip: "Close (Esc)" })));
    if (!this.items) return frame.child(this.error
      ? blankslate(t, { icon: "alert", tone: primer(t).closed, title: "Couldn't load the board", body: this.error, actions: [button("retry", "Retry", t, (_e, cx) => this.load(cx), { icon: "refresh" })] })
      : blankslate(t, { icon: "spin", title: "Loading the board…", body: `Issues and pull requests of ${this.repo}.` }));
    // Read once per render: agents() and shared() cross into the app.
    this.work = shared("github.work") ?? {};
    this.agentsNow = liveAgents();
    const cols = columns(this.items, this.work, this.agentsNow);
    return frame.child(h_flex().flex_1().min_h(0).p(16).gap(12).items_start().children(STAGES.map((s) => this.column(s, cols[s[0]], t))));
  }
}

// Move a card: a popup of this mod under its button (or at the pointer for a right-click).
export function stageMenu(key, at = under(220)) {
  openOverlay({ mod: "github", kind: "popup", width: 220, height: 14 + 5 * 34, at, props: { stageMenu: { key } } });
}
export function renderStageMenu({ key }, overlay, t) {
  const mark = (shared("github.work") ?? {})[key];
  const row = (id, label, on, pick) => h_flex().id(id).h(32).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click(() => { pick(); closeOverlay(overlay); })
    .child(div().size(14).flex_none().when(on, (e) => e.child(glyph("check", 14, t.foreground)))).child(div().child(label));
  return v_flex().id("stage-menu").size_full().p(6).gap(1).bg(t.popover).text_color(t.foreground).text_size(13)
    .children(STAGES.filter(([k]) => k !== "done").map(([k, label]) => row(`stage-${k}`, label, mark?.by === "hand" && mark.stage === k, () => setWork(key, k))))
    .child(div().h(1).my(3).bg(t.border))
    .child(row("stage-auto", "Auto", !mark || mark.by !== "hand", () => setWork(key, null)));
}
