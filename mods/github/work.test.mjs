// node mods/github/work.test.mjs
import { stageOf, marked, ref, columns, branchFor, worktreePath, worktreeNote, agentOf, changesOf, cleanupOf } from "./work.js";
import { slug } from "./brief.js";
import assert from "assert";

const open = { repo: "o/r", number: 7, state: "OPEN" };
assert.equal(ref(open), "o/r#7");
assert.equal(stageOf(open).stage, "todo", "nothing known: to do");
assert.equal(stageOf({ ...open, state: "CLOSED" }, { stage: "doing", by: "hand" }).stage, "done", "closed wins over a hand mark");
assert.equal(stageOf({ ...open, state: "MERGED", headRefName: "x" }).why, "Merged");
assert.deepEqual(stageOf(open, { stage: "doing", by: "brief" }), { stage: "todo", why: null }, "a copied brief (old mark) is not work started");
assert.equal(stageOf(open, { stage: "doing", by: "agent", tab: "#7 r" }, []).why, "Agent started", "agent tab gone: still in progress");
const agent = { tab_name: "#7 r", status: "working" };
assert.equal(stageOf(open, { stage: "doing", by: "agent", tab: "#7 r" }, [agent]).why, "Agent working");
assert.equal(stageOf(open, { stage: "doing", by: "agent", tab: "#7 r" }, [{ ...agent, status: "blocked" }]).why, "Agent needs you");
assert.equal(stageOf(open, { stage: "doing", by: "agent", tab: "#7 r" }, [{ ...agent, status: "idle" }]).why, "Agent finished");
for (const status of ["done", "idle"]) assert.equal(stageOf(open, { stage: "doing", by: "agent", tab: "#7 r" }, [{ ...agent, status }]).stage, "review", `${status}: yours to review`);
assert.equal(stageOf(open, { stage: "doing", by: "hand", tab: "#7 r" }, [{ ...agent, status: "done" }]).stage, "doing", "a hand mark still wins");
assert.equal(stageOf({ ...open, closedByPullRequestsReferences: [{ number: 9 }] }).stage, "review", "a linked PR: in review");
assert.equal(stageOf({ ...open, closedByPullRequestsReferences: [{ number: 9 }] }, null, [agent]).stage, "review", "no mark: a stray agent tab isn't matched");
assert.equal(stageOf({ ...open, closedByPullRequestsReferences: [] }, { stage: "todo", by: "hand" }).stage, "todo", "hand mark wins over auto");
assert.equal(stageOf({ ...open, closedByPullRequestsReferences: [{ number: 9 }] }, { stage: "todo", by: "hand" }).stage, "todo", "hand mark wins over a linked PR");
assert.equal(stageOf({ ...open, headRefName: "b", isDraft: true }).stage, "doing", "draft PR");
assert.equal(stageOf({ ...open, headRefName: "b", isDraft: false }).stage, "review", "open PR");
assert.equal(stageOf({ ...open, state: "open" }).stage, "todo", "lowercase state (search results)");
assert.equal(stageOf({ ...open, state: "closed" }).stage, "done", "lowercase closed");

const m = marked({}, "o/r#7", "doing", { by: "agent" });
assert.equal(m["o/r#7"].stage, "doing"); assert.equal(m["o/r#7"].by, "agent");
assert.deepEqual(marked(m, "o/r#7", null), {}, "null removes");
assert.deepEqual(marked(undefined, "a#1", null), {}, "no marks yet");
const before = { "a#1": { stage: "doing" } }; marked(before, "b#2", "todo");
assert.deepEqual(Object.keys(before), ["a#1"], "input untouched");
const items = [
  { repo: "o/r", number: 1, state: "OPEN", updatedAt: "2026-01-01" },
  { repo: "o/r", number: 2, state: "OPEN", updatedAt: "2026-01-03", closedByPullRequestsReferences: [{ number: 5 }] },
  { repo: "o/r", number: 3, state: "CLOSED", updatedAt: "2026-01-02" },
  { repo: "o/r", number: 4, state: "OPEN", updatedAt: "2026-01-04" },
  { repo: "o/r", number: 5, state: "OPEN", headRefName: "fix", isDraft: false, updatedAt: "2026-01-05" },
  { repo: "o/r", number: 6, state: "OPEN", headRefName: "wip", isDraft: true, updatedAt: "2026-01-06" },
];
const c = columns(items, { "o/r#4": { stage: "doing", by: "agent" }, "o/r#1": { stage: "doing", by: "brief" } });
const nums = (k) => c[k].map((x) => x.item.number);
assert.deepEqual(nums("todo"), [1]);
assert.deepEqual(nums("doing"), [6, 4], "newest first; draft PR in progress");
assert.deepEqual(nums("review"), [2], "PR #5 closes #2: one card, the issue's");
assert.deepEqual(nums("done"), [3]);
assert.equal(c.doing[0].kind, "pr"); assert.equal(c.doing[1].kind, "issue");
assert.deepEqual(Object.values(columns([])).flat(), [], "empty board");
// The agent's worktree.
assert.equal(branchFor({ kind: "issue", number: 12, title: "Export: save a note as PDF", labels: [] }, slug), "feat/12-export-save-a-note-as-pdf");
assert.equal(branchFor({ kind: "issue", number: 3, title: "Crash", labels: [{ name: "bug" }] }, slug), "fix/3-crash");
assert.equal(branchFor({ kind: "issue", number: 4, title: "🎉", labels: [] }, slug), "feat/4", "no usable word: no dangling dash");
assert.equal(branchFor({ kind: "pr", number: 9, headRefName: "someone/topic" }, slug), "someone/topic");
assert.equal(worktreePath("/home/a", "o/bref#12", "issue"), "/home/a/.herdr/worktrees/bref/o-issue-12");
assert.notEqual(worktreePath("/h", "alice/p#7", "pr"), worktreePath("/h", "bob/p#7", "pr"), "two forks' #7 never share a folder");
const note = worktreeNote({ folder: "/w/f", branch: "feat/1-x", base: "origin/main" });
assert.match(note, /`\/w\/f`, on branch `feat\/1-x`, created from `origin\/main`/); assert.match(note, /Don't create or switch branches/); assert.match(note, /replaces any step below that gets or creates a branch/); assert.doesNotMatch(note, /existed already/);
assert.match(worktreeNote({ folder: "/w/f", branch: "b", reused: true }), /existed already/);
const wt = { stage: "doing", by: "agent", tab: "#7 api", folder: "/h/.herdr/worktrees/api/feat-7-x" };
const there = { tab_name: "#7 api", cwd: "/h/.herdr/worktrees/api/feat-7-x/src", status: "working" };
const homonym = { tab_name: "#7 api", cwd: "/elsewhere", status: "blocked" };
assert.equal(agentOf(wt, [homonym, there]), there, "the folder wins over a tab of the same name");
assert.equal(agentOf(wt, [{ ...there, cwd: "/h/.herdr/worktrees/api/feat-7-xy" }]), null, "a sibling folder with a longer name isn't it");
assert.equal(agentOf({ stage: "doing", by: "agent", tab: "#7 api" }, [homonym]), homonym, "no worktree: the tab name, as before");
assert.equal(agentOf(null, [there]), null);
assert.equal(stageOf(open, { ...wt, folder: "/x" }, [{ status: "working", cwd: "/x" }]).why, "Agent working");
assert.equal(agentOf({ folder: "/x", space: "s1" }, [{ space: "vps/s1", cwd: "/x" }]), null, "the same path on another machine is not it");
assert.equal(agentOf({ folder: "/x", space: "s1" }, [{ space: "vps/s1", cwd: "/x" }, { space: "s1", cwd: "/x", n: 1 }]).n, 1);
assert.equal(agentOf({ folder: "/x", space: "s1" }, [{ space: "s2", cwd: "/x", n: 2 }]).n, 2, "its tab moved to another space here: still found");
assert.equal(agentOf({ folder: "/x", space: "vps/s1" }, [{ space: "vps/s3", cwd: "/x", n: 3 }]).n, 3, "moved between spaces of the same remote machine");
assert.equal(agentOf({ folder: "/x", space: "vps/s1" }, [{ space: "box/s1", cwd: "/x" }, { space: "s1", cwd: "/x" }]), null, "another machine, or this one: not it");
assert.equal(agentOf({ folder: "/x", space: null }, [{ space: "vps/s1", cwd: "/x", n: 4 }]).n, 4, "no space recorded: the folder alone, as before");
// Changes follows the finished agent's worktree, including a cwd below its root.
for (const status of ["done", "idle"]) {
  const s = stageOf(open, wt, [{ ...there, status }]);
  assert.deepEqual(changesOf(wt, s), { root: wt.folder, on: null, range: "origin/HEAD..HEAD" }, "no base recorded (older marks)");
  assert.equal(changesOf({ ...wt, base: "main" }, s).range, "main..HEAD", "the base the worktree started from");
}
for (const status of ["working", "blocked"]) assert.equal(changesOf(wt, stageOf(open, wt, [{ ...there, status }])), null);
assert.equal(changesOf(null, stageOf(open)), null);
assert.equal(changesOf({ tab: "#7 r" }, stageOf(open, { tab: "#7 r" }, [{ ...agent, status: "done" }])), null, "no worktree: no Changes button");
assert.equal(changesOf(wt, stageOf(open, wt, [])), null, "agent gone is not Agent finished");
assert.equal(changesOf(wt, stageOf({ ...open, state: "CLOSED" }, wt, [{ ...there, status: "done" }])), null);
assert.equal(changesOf(wt, stageOf({ ...open, headRefName: "b" }, null)), null, "an open PR alone is not finished work");
const hand = { ...wt, by: "hand", stage: "review" };
assert.equal(changesOf(hand, stageOf(open, hand, [{ ...there, status: "done" }])), null, "manual review is not Agent finished");
// Clean up: closed or merged, with a worktree, and no agent still in it.
const merged = { ...open, state: "MERGED", headRefName: "b" }, closedIssue = { ...open, state: "CLOSED" };
assert.equal(cleanupOf(wt, stageOf(merged, wt, []), []), true, "merged PR with a worktree");
assert.equal(cleanupOf(wt, stageOf(closedIssue, wt, []), []), true, "closed issue with a worktree");
assert.equal(cleanupOf(wt, stageOf(merged, wt, []), [{ ...there, status: "idle" }]), false, "an agent still sits in it");
assert.equal(cleanupOf(wt, stageOf(open, wt, [{ ...there, status: "done" }]), [{ ...there, status: "done" }]), false, "still open");
assert.equal(cleanupOf({ tab: "#7 r" }, stageOf(closedIssue, { tab: "#7 r" }, []), []), false, "no worktree");
assert.equal(cleanupOf(null, stageOf(closedIssue)), false);
assert.equal(cleanupOf(wt, { stage: "done", why: "Set by you" }, []), false, "done by hand is not merged");
console.log("work ok");
