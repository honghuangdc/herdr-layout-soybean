import { v_flex, h_flex } from "gpui-base";
import { div, svg, image } from "gpui-kit";
import { run, notify, openOverlay, closeOverlay, knownAgents, spaces, panes, agents, shared, setShared, exec, home } from "herdr";
import { glyph, spinner, under } from "./ui.js";
import { marked, branchFor, worktreePath, worktreeNote } from "./work.js";
import { slug } from "./brief.js";

// Records what is being done about owner/repo#N (work.js). A stage you set by hand is never overwritten by a brief or an agent.
export function setWork(key, stage, extra = { by: "hand" }) {
  const marks = shared("github.work") ?? {};
  if (extra.by !== "hand" && marks[key]?.by === "hand") return;
  setShared("github.work", marked(marks, key, stage, extra));
}

export function copied(cx, text, title, body) {
  cx.write_to_clipboard(text);
  notify({ title, body, level: "success", timeout: 2500 });
}

// The last agent started and the worktree choice, in shared github.agent: localStorage is per mod copy, and each menu is a new one.
const remembered = (k) => (shared("github.agent") ?? {})[k];
const remember = (k, v) => setShared("github.agent", { ...(shared("github.agent") ?? {}), [k]: v });

// The agent menu: a popup of this mod listing the installed agents, under the button that asked.
// task: { name, brief, folder (the local clone), space, ref, work?: { kind, number, title, labels, headRefName } }.
export function pickAgent(task) {
  openOverlay({ mod: "github", kind: "popup", width: 300, height: 340, at: under(300), props: { agentMenu: task } });
}

// What the worktree is named from: kind, number, title, labels, and a pull request's branch.
export const workOf = (i, kind) => ({ kind, number: i.number, title: i.title, labels: (i.labels ?? []).map((l) => l.name ?? l), headRefName: i.headRefName });

// Herdr's agents, each with the folder its pane is in (what ties an agent to its worktree, work.js agentOf).
export function liveAgents() {
  const byPane = new Map(panes().map((p) => [p.pane, p.cwd]));
  return agents().map((a) => ({ ...a, cwd: byPane.get(a.pane) ?? null }));
}

// The worktree an agent works in: ~/.herdr/worktrees/<repo>/<branch>, from the clone's default branch freshly
// fetched (an issue), or the pull request's branch (gh pr checkout). Already there: reused as it is.
export async function prepareWorktree({ folder, ref, work }) {
  const git = async (args, cwd = folder) => {
    const r = await exec("git", args, { cwd });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`);
    return r.stdout.trim();
  };
  const repo = ref.split("#")[0], branch = branchFor(work, slug), path = worktreePath(home(), ref, work.kind);
  await git(["worktree", "prune"]); // forgets worktrees whose folder was deleted by hand
  const known = (await git(["worktree", "list", "--porcelain"])).split("\n").some((l) => l === `worktree ${path}`);
  // Its branch as it is, which may be pr-N after a fallback.
  // from: the ref it started from, what Changes counts the agent's commits from (null when unknown: reused).
  if (known) return { folder: path, branch: await git(["rev-parse", "--abbrev-ref", "HEAD"], path), base: null, from: null, reused: true };
  await git(["fetch", "--quiet", "origin"]).catch(() => null); // offline: the local refs will do
  const base = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => git(["rev-parse", "--abbrev-ref", "HEAD"]));
  if (work.kind === "pr") {
    await git(["worktree", "add", "--detach", path, base]);
    const r = await exec("gh", ["pr", "checkout", String(work.number), "-R", repo], { cwd: path });
    if (r.code !== 0) { // its branch is checked out elsewhere (often the clone itself): a local name of its own
      const again = await exec("gh", ["pr", "checkout", String(work.number), "-R", repo, "--branch", `pr-${work.number}`], { cwd: path });
      if (again.code !== 0) { // not left behind on the base commit, where a retry would reuse it
        await git(["worktree", "remove", "--force", path]).catch(() => null);
        throw new Error((again.stderr || r.stderr).trim() || "gh pr checkout failed");
      }
      return { folder: path, branch: `pr-${work.number}`, base: null, from: base, reused: false };
    }
    return { folder: path, branch, base: null, from: base, reused: false };
  }
  const exists = await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false);
  await git(exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base]);
  return { folder: path, branch, base: exists ? null : base, from: exists ? null : base, reused: exists };
}

// Removes an agent's worktree, then its branch if origin's default branch holds it (merged, freshly fetched).
// git refuses a worktree with uncommitted changes: that error is thrown and nothing is touched. A branch
// not in the base (a squash merge, or closed unmerged) is kept: returned as deleted: false.
// A folder already gone (deleted by hand): { gone: true }, nothing to do.
export async function removeWorktree({ folder }) {
  const at = (cwd) => async (args) => {
    const r = await exec("git", args, { cwd }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`);
    return r.stdout.trim();
  };
  const common = await at(folder)(["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => null);
  if (!common) return { gone: true };
  const clone = common.replace(/\/\.git\/?$/, ""), git = at(clone);
  const branch = await at(folder)(["rev-parse", "--abbrev-ref", "HEAD"]);
  await git(["worktree", "remove", folder]);
  if (branch === "HEAD") return { branch: null, deleted: false };
  await git(["fetch", "--quiet", "origin"]).catch(() => null);
  const base = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => git(["rev-parse", "--abbrev-ref", "HEAD"]));
  const merged = await git(["merge-base", "--is-ancestor", branch, base]).then(() => true, () => false);
  if (merged) await git(["branch", "-D", branch]);
  return { branch, base, deleted: merged };
}
// The "Clean up" button: removes the worktree, forgets the mark, says what was kept.
export async function cleanUp(key, mark) {
  try {
    const r = await removeWorktree(mark);
    setWork(key, null);
    notify({ title: r.gone ? "Worktree already gone" : "Worktree removed", level: "success", timeout: 4000,
      body: r.gone || !r.branch ? key : r.deleted ? `${key} · branch ${r.branch} deleted` : `${key} · branch ${r.branch} kept: not in ${r.base} (squash merge or unmerged)` });
  } catch (e) { notify({ title: "Worktree kept", body: String(e?.message ?? e), level: "error", timeout: 8000 }); }
}

// Its tab, focused: what "Join" does wherever an agent is shown.
export const joinAgent = (agent) => run("agent.focus", { terminal: agent.address });
export const showChanges = (history) => openOverlay({ mod: "git", kind: "dialog", width: 0.92, height: 0.9, props: { history } });

// Starts the agent in a new tab, in the clone's space when there is one, with the brief as its first message.
// wt: the worktree prepared for it, if any: the agent starts there and its brief says so first.
export function launch(agent, { name, brief, folder, space, ref }, wt = null) {
  const args = { name: name.slice(0, 48), argv: agent.run, task: wt ? worktreeNote(wt) + brief : brief };
  const home = space ?? spaces().find((s) => !s.machine && folder && s.folder === folder)?.id ?? spaces().find((s) => s.active)?.id;
  if (home) args.space = home;
  if (ref) setWork(ref, "doing", { by: "agent", tab: args.name, ...(wt ? { folder: wt.folder, branch: wt.branch, space: home ?? null, base: wt.from ?? (shared("github.work") ?? {})[ref]?.base ?? null } : {}) });
  if (wt) args.folder = wt.folder; else if (folder) args.folder = folder;
  run("tab.new", args);
  notify({ title: `${agent.name} started`, body: name, level: "success", timeout: 3000 });
}

export class AgentMenu {
  constructor(task, overlay, cx) {
    this.task = task; this.overlay = overlay; this.agents = null;
    // A worktree of its own when there is a clone to make it from and a branch to name it by (search results carry no PR branch).
    this.branch = task.folder && task.work && task.ref ? branchFor(task.work, slug) ?? null : null;
    this.isolate = Boolean(this.branch) && remembered("isolate") !== false;
    // The last agent started comes first, so the usual pick is the first row.
    const last = remembered("last");
    cx.spawn(async (cx) => { this.agents = (await knownAgents().catch(() => [])).filter((a) => a.installed && a.run?.length).sort((a, b) => (b.name === last) - (a.name === last)); cx.notify(); });
  }
  render(cx, t) {
    const list = this.agents;
    return v_flex().id("agent-menu").size_full().p(6).gap(1).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(div().px(8).pt(4).pb(6).text_size(11).font_semibold().text_color(t.dim).child(`Start an agent on ${this.task.name}`))
      .when(!list, (e) => e.child(div().px(8).py(6).text_color(t.muted).child("Looking for agents…")))
      .when(list?.length === 0, (e) => e.child(div().px(8).py(6).text_size(12).text_color(t.muted).child("No agent installed. Add one in programs.json.")))
      .children((list ?? []).map((a, n) => h_flex().id(`agent-${n}`).h(32).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.start(a, cx))
        .child(div().size(16).flex_none().when(Boolean(a.icon), (e) => e.child(a.tint ? svg(a.icon).size(16).text_color(t.muted) : image(a.icon).size(16))))
        .child(div().flex_1().truncate().child(a.name))))
      .child(div().flex_1())
      .when(Boolean(this.error), (e) => e.child(div().px(8).py(4).text_size(11.5).text_color("#f85149").child(this.error)))
      .when(Boolean(this.branch), (e) => e.child(h_flex().id("isolate").px(8).py(6).gap(8).items_center().border_t(1).border_color(t.border).cursor_pointer().text_size(12)
        .on_click((_e, cx) => { this.isolate = !this.isolate; cx.notify(); })
        .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(3).border_1().border_color(this.isolate ? t.accent : t.border).bg(this.isolate ? t.accent : "#00000000")
          .when(this.isolate, (x) => x.child(glyph("check", 11, t.accent_foreground ?? t.background))))
        .child(v_flex().min_w(0).child(div().child("In a new worktree"))
          .child(div().truncate().text_size(11).text_color(t.dim).child(this.isolate ? `on ${this.branch}` : "in the clone, on its current branch")))))
      .child(h_flex().px(8).py(6).gap(6).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(this.busy ? spinner(12, t.dim) : glyph("folder", 12, t.dim))
        .child(div().truncate().child(this.busy ?? (!this.task.folder ? "Not cloned here: the agent will clone it" : this.isolate ? worktreePath(home(), this.task.ref, this.task.work.kind) : this.task.folder))));
  }
  // The menu stays open while the worktree is made (its task would end with it), then starts the agent.
  start(agent, cx) {
    if (this.busy) return;
    remember("last", agent.name);
    if (this.branch) remember("isolate", this.isolate);
    if (!this.isolate) { launch(agent, this.task); return closeOverlay(this.overlay); }
    this.busy = "Preparing the worktree…"; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try { launch(agent, this.task, await prepareWorktree(this.task)); closeOverlay(this.overlay); }
      catch (e) { this.busy = null; this.error = `Worktree failed: ${String(e?.message ?? e).split("\n")[0]}. Untick it to start in the clone.`; cx.notify(); }
    });
  }
}

// Copy link / reference / number / brief: under its button, or at the pointer for a right-click.
export function copyMenu(items, at = under(300)) {
  openOverlay({ mod: "github", kind: "popup", width: 300, height: 14 + items.length * 48, at, props: { copyMenu: items } });
}
export function renderCopyMenu(items, overlay, t) {
  return v_flex().id("copy-menu").size_full().p(6).gap(1).bg(t.popover).text_color(t.foreground).text_size(12)
    .children(items.map(([label, text, preview], n) => v_flex().id(`copy-${n}`).h(46).flex_none().justify_center().px(8).rounded(6).cursor_pointer()
      .hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => { copied(cx, text, "Copied", preview ?? text); closeOverlay(overlay); })
      .child(div().font_semibold().child(label))
      .child(div().text_size(11).text_color(t.muted).truncate().child(preview ?? text))));
}
