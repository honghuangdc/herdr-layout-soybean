// Where an issue or pull request stands, beyond GitHub's open and closed: To do, In progress, In review, Done.
// Marks live in shared("github.work"), so the panel, the dialogs and every copy see the same thing:
// { "owner/repo#12": { stage: "doing", by: "agent" | "hand", tab?: "#12 repo", at } }.
export const STAGES = [["todo", "To do"], ["doing", "In progress"], ["review", "In review"], ["done", "Done"]];
export const ref = (item) => `${item.repo}#${item.number}`;

const closed = (i) => /^(CLOSED|MERGED)$/.test(String(i.state).toUpperCase());

// item: a list row or the full issue/PR; mark: its entry in github.work; agents: herdr's agents().
// Returns { stage, why, agent } where agent is the live agent working on it, if any.
export function stageOf(item, mark, agents = [], kind = item.headRefName !== undefined ? "pr" : "issue") {
  if (closed(item)) return { stage: "done", why: String(item.state).toUpperCase() === "MERGED" ? "Merged" : "Closed" };
  const agent = agentOf(mark, agents);
  if (mark?.by === "hand") return { stage: mark.stage, why: "Set by you", agent };
  // Finished (done, or idle once looked at): its work is yours to review.
  if (agent) return agent.status === "working" ? { stage: "doing", why: "Agent working", agent }
    : agent.status === "blocked" ? { stage: "doing", why: "Agent needs you", agent } : { stage: "review", why: "Agent finished", agent };
  if (kind === "pr") return item.isDraft ? { stage: "doing", why: "Draft" } : { stage: "review", why: "Open pull request" };
  if ((item.closedByPullRequestsReferences ?? []).length) return { stage: "review", why: `PR #${item.closedByPullRequestsReferences[0].number}` };
  // A copied brief is not work started; older "brief" marks are ignored.
  if (mark && mark.by !== "brief") return { stage: mark.stage ?? "doing", why: "Agent started" };
  return { stage: "todo", why: null };
}

// Worktrees prepared by launch() live on this machine; the git mod uses null for local execution.
export const changesOf = (mark, s) => mark?.folder && s.stage === "review" && s.why === "Agent finished" ? { root: mark.folder, on: null, range: `${mark.base ?? "origin/HEAD"}..HEAD` } : null;

// Closed or merged, its worktree still there and no agent left in it: the worktree can go.
export const cleanupOf = (mark, s, agents = []) => Boolean(mark?.folder) && /^(Merged|Closed)$/.test(s.why ?? "") && !agentOf(mark, agents);

// A new marks object (shared values are replaced whole). stage null removes the mark.
export function marked(marks, key, stage, extra = {}) {
  const next = { ...(marks ?? {}) };
  if (stage) next[key] = { stage, at: Date.now(), ...extra }; else delete next[key];
  return next;
}

// The board's columns: every item in its stage, most recently updated first. A pull request that
// closes an issue on the board is that issue's card, not a second one.
export function columns(items, marks = {}, agents = []) {
  const linked = new Set(items.flatMap((i) => (i.closedByPullRequestsReferences ?? []).map((r) => `${i.repo}#${r.number}`)));
  const out = Object.fromEntries(STAGES.map(([k]) => [k, []]));
  for (const i of items) {
    const kind = i.headRefName !== undefined ? "pr" : "issue";
    if (kind === "pr" && linked.has(ref(i))) continue;
    const s = stageOf(i, marks[ref(i)], agents, kind);
    out[s.stage].push({ item: i, kind, ...s });
  }
  for (const k in out) out[k].sort((a, b) => Date.parse(b.item.updatedAt ?? 0) - Date.parse(a.item.updatedAt ?? 0));
  return out;
}

// ---- the agent's own worktree ----
// The branch an issue's agent works on, as the brief has always named it; a pull request keeps its own.
export function branchFor({ kind, number, title, labels = [], headRefName }, slug) {
  if (kind === "pr") return headRefName;
  return `${labels.some((l) => /bug/i.test(l.name ?? l)) ? "fix" : "feat"}/${number}-${slug(title)}`.replace(/-$/, "");
}
// Under Herdr's <home>/.herdr/worktrees/<repo>/, one folder per item, named by the item and not its branch:
// short, ASCII and unique even for two forks' "topic" branches or alice/proj#7 next to bob/proj#7.
export const worktreePath = (home, ref, kind) => { const [owner, name] = ref.split("#")[0].split("/"); return `${home}/.herdr/worktrees/${name}/${owner}-${kind}-${ref.split("#")[1]}`; };
// Put first in the agent's brief: where it already is, so it neither branches again nor leaves.
export function worktreeNote({ folder, branch, base, reused }) {
  return [
    "## Workspace (already prepared)",
    "",
    `- You are in a dedicated git worktree: \`${folder}\`, on branch \`${branch}\`${base ? `, created from \`${base}\`` : ""}${reused ? " (it existed already: read `git log` and `git status` first, earlier work may be there)" : ""}.`,
    "- Work and commit there. Don't create or switch branches, don't touch the main checkout: this replaces any step below that gets or creates a branch.",
    "",
    "",
  ].join("\n");
}
// The agent on that item: the one working in its worktree; without a worktree, the tab it was started in
// (a name, so two repositories called the same can mix up: the worktree is what makes it exact).
// herdr: remote space ids have a machine/ prefix; this computer's have none.
const machineOf = (space) => space?.includes("/") ? space.split("/")[0] : null;
export function agentOf(mark, agents) {
  // The same path can exist on another machine: the machine of its space tells them apart, not the space
  // itself, so a tab moved to another space on the same machine is still found.
  if (mark?.folder) return agents.find((a) => a.cwd && (!mark.space || machineOf(a.space) === machineOf(mark.space)) && (a.cwd === mark.folder || a.cwd.startsWith(`${mark.folder}/`))) ?? null;
  return mark?.tab ? agents.find((a) => a.tab_name === mark.tab) ?? null : null;
}
