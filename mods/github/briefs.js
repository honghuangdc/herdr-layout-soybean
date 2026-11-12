import { div } from "gpui-kit";
import { v_flex, h_flex, EditorState, Editor } from "gpui-base";
import { theme, closeOverlay, openOverlay, notify, shared, setShared } from "herdr";
import { primer, glyph, button } from "./ui.js";
import { DEFAULTS, VARS, unknownVars, issueBrief, prReviewBrief, prFixBrief, runBrief } from "./brief.js";

// The brief templates you edit, in shared github.briefs ({ name: text }): localStorage is per mod copy, and this dialog,
// the panel, the issue dialog and the run dialog are each a copy. Only the ones that differ from the default are kept.
const KEY = "github.briefs";
export function savedTemplates() {
  const s = shared(KEY), out = {};
  for (const name of Object.keys(DEFAULTS)) if (typeof s?.[name] === "string") out[name] = s[name];
  return out;
}
function save(name, text) {
  const next = savedTemplates();
  if (text === DEFAULTS[name]) delete next[name]; else next[name] = text;
  setShared(KEY, next);
}

// sample: what the preview is built on, { kind: "issue" | "pr" | "run", data, local, jobs, log }; pick: the template shown first.
export function openBriefs(sample = null, pick = null) {
  openOverlay({ mod: "github", kind: "dialog", width: 0.9, height: 0.9, props: { briefs: { sample, pick } } });
}

const LIST = [
  ["Briefs", [["issue", "Issue", "Start agent and Copy brief on an issue"], ["review", "Pull request · Review", "Review on a pull request: read-only"], ["fix", "Pull request · Fix", "Fix on a pull request: checks and requested changes"], ["run", "CI run", "Fix with agent on a failed run"]]],
  ["Shared blocks", [["conventions", "Conventions", "{{conventions}}: read the repository's own rules first"], ["rules", "Rules", "{{rules}}: what the agent may and may not do"], ["report", "Report", "{{report}}: what it tells you at the end"]]],
];
const INFO = Object.fromEntries(LIST.flatMap(([, rows]) => rows.map(([name, label, about]) => [name, { label, about }])));

// The preview's example when the dialog wasn't opened from an issue, pull request or run of that kind.
const SAMPLES = {
  issue: { repo: "octo/app", number: 42, title: "Crash when the list is empty", url: "https://github.com/octo/app/issues/42", labels: [{ name: "bug" }], author: { login: "octocat" },
    body: "Opening the list with no items crashes.\n\nExpected: an empty state.", comments: [{ author: { login: "hubot" }, body: "Same here on 2.1." }] },
  pr: { repo: "octo/app", number: 43, title: "Show an empty state", url: "https://github.com/octo/app/pull/43", headRefName: "fix/42-empty-list", baseRefName: "main", additions: 24, deletions: 3, changedFiles: 2,
    reviewDecision: "CHANGES_REQUESTED", closingIssuesReferences: [{ number: 42 }], body: "Closes #42.", checks: { state: "failure", failed: [{ workflow: "CI", name: "test", conclusion: "failure" }] },
    reviews: [{ author: { login: "hubot" }, state: "CHANGES_REQUESTED", body: "Add a test for the empty case." }] },
  run: { repo: "octo/app", url: "https://github.com/octo/app/actions/runs/1", workflowName: "CI", event: "push", headBranch: "main", headSha: "4f2a9c1e7b3d", displayTitle: "Show an empty state", databaseId: 1 },
};
const SAMPLE_JOBS = [{ name: "test", conclusion: "failure", steps: [{ name: "npm test", conclusion: "failure" }] }];

export class BriefEditor {
  constructor({ sample, pick }, overlay, cx) {
    this.sample = sample; this.overlay = overlay; this.saved = savedTemplates();
    this.name = INFO[pick] ? pick : sample?.kind === "pr" ? "fix" : sample?.kind === "run" ? "run" : "issue";
    this.editor = EditorState.new({ language: "markdown", value: this.text(), soft_wrap: true, folding: false });
    this.editor.on("change", (_e, cx) => {
      const text = this.editor.value();
      if (text === this.text()) return; // set_value when switching template
      save(this.name, text); this.saved = savedTemplates(); cx.notify();
    });
  }
  text(name = this.name) { return this.saved[name] ?? DEFAULTS[name]; }
  pick(name, cx) { this.name = name; this.editor.set_value(this.text()); cx.notify(); }
  reset(cx) { save(this.name, DEFAULTS[this.name]); this.saved = savedTemplates(); this.editor.set_value(DEFAULTS[this.name]); cx.notify(); }

  // The brief the shown template makes: on the item the dialog came from when it is of that kind, else on the example.
  preview() {
    const s = this.sample, n = this.name;
    const brief = ["issue", "review", "fix", "run"].includes(n) ? n : s?.kind === "pr" ? "fix" : s?.kind ?? "issue";
    const kind = brief === "review" || brief === "fix" ? "pr" : brief;
    const own = s?.kind === kind && s.data, data = own ? s.data : SAMPLES[kind];
    const opts = { local: own ? s.local : null, templates: this.saved };
    const text = kind === "run" ? runBrief(data, { ...opts, jobs: own ? s.jobs : SAMPLE_JOBS, log: own ? s.log : "Error: expected [] to render \"No items\"" })
      : { issue: issueBrief, review: prReviewBrief, fix: prFixBrief }[brief](data, opts);
    const on = kind === "run" ? `${data.workflowName} on ${data.headBranch}` : `${data.repo}#${data.number}`;
    return { text, source: `${INFO[brief].label} brief on ${own ? on : `an example (${on})`}` };
  }

  render(cx) {
    const t = theme(), p = primer(t), n = this.name, edited = this.saved[n] !== undefined;
    const vars = VARS[n], unknown = unknownVars(this.text(), vars.map(([k]) => k)), { text, source } = this.preview();
    const bar = () => h_flex().h(44).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border);
    return v_flex().id("briefs").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(52).flex_none().px(20).gap(10).items_center().border_b(1).border_color(t.border)
        .child(glyph("brief", 16, t.foreground)).child(div().text_size(16).font_semibold().child("Brief templates"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child("What Copy brief and the agents receive. Saved as you type."))
        .child(button("close", "", t, () => closeOverlay(this.overlay), { icon: "close", invisible: true, tooltip: "Close (Esc)" })))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().w(220).h_full().flex_none().p(8).gap(2).border_r(1).border_color(t.border)
          .children(LIST.flatMap(([group, rows]) => [
            div().px(8).pt(group === "Briefs" ? 4 : 14).pb(4).text_size(11).font_semibold().text_color(t.dim).child(group),
            ...rows.map(([name, label]) => h_flex().id(`tpl-${name}`).h(32).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
              .bg(name === n ? t.hover : "#00000000").hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.pick(name, cx))
              .child(div().flex_1().min_w(0).truncate().when(name === n, (x) => x.font_semibold()).child(label))
              .when(this.saved[name] !== undefined, (e) => e.child(div().text_size(10.5).text_color(p.attention).child("edited")))),
          ])))
        .child(v_flex().flex_1().min_w(0).h_full().border_r(1).border_color(t.border)
          .child(bar().child(v_flex().flex_1().min_w(0)
              .child(div().font_semibold().truncate().child(INFO[n].label))
              .child(div().text_size(11.5).text_color(t.muted).truncate().child(INFO[n].about)))
            .child(button("reset", "Reset to default", t, (_e, cx) => this.reset(cx), { icon: "refresh", small: true, enabled: edited, tooltip: edited ? "Drop your changes to this template" : "This is the default" })))
          .child(div().id("tpl-editor").flex_1().min_h(0).child(Editor.new(this.editor).size_full()))
          .child(v_flex().id("tpl-vars").flex_none().max_h(170).overflow_y_scrollbar().px(16).py(10).gap(8).border_t(1).border_color(t.border)
            .when(unknown.length > 0, (e) => e.child(div().text_size(12).text_color(p.closed).child(`Unknown: ${unknown.map((k) => `{{${k}}}`).join(", ")}. Left as written in the brief.`)))
            .child(div().text_size(11).font_semibold().text_color(t.dim).child("Variables · click to copy"))
            .child(h_flex().flex_wrap().gap(6).children(vars.map(([k, about]) => div().id(`var-${k}`).h(22).px(7).flex().items_center().rounded(4)
              .bg(t.raised).border_1().border_color(t.border).font_family("JetBrains Mono").text_size(11.5).cursor_pointer().hover((s) => s.bg(t.hover))
              .tooltip(about).on_click((_e, cx) => { cx.write_to_clipboard(`{{${k}}}`); notify({ title: `{{${k}}} copied`, body: about, timeout: 1500 }); })
              .child(`{{${k}}}`))))
            .child(div().text_size(11.5).text_color(t.muted).child("A line holding only an empty variable disappears. GitHub text stays inside its tags; it is never read as a variable."))))
        .child(v_flex().flex_1().min_w(0).h_full()
          .child(bar().child(div().font_semibold().child("Preview")).child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(source))
            .child(button("copy-preview", "", t, (_e, cx) => { cx.write_to_clipboard(text); notify({ title: "Preview copied", body: source, level: "success", timeout: 2000 }); }, { icon: "copy", invisible: true, small: true, tooltip: "Copy this brief" })))
          .child(div().id("tpl-preview").flex_1().min_h(0).overflow_y_scrollbar().p(16).font_family("JetBrains Mono").text_size(12).text_color(t.foreground).child(text))));
  }
}
