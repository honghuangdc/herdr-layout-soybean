// node mods/github/timeline.test.mjs
import assert from "assert";
import { entries, tally } from "./timeline.js";

const me = { login: "ana", avatar_url: "https://a/ana" }, bob = { login: "bob" };
const at = (m) => `2026-11-03T10:${String(m).padStart(2, "0")}:00Z`;
const bug = { name: "bug", color: "d73a4a" }, ui = { name: "ui", color: "0e8a16" };

assert.deepEqual(entries([]), [], "empty timeline");
assert.deepEqual(entries(null), [], "no timeline");
assert.deepEqual(entries([{ event: "subscribed", actor: me }, { event: "added_to_project", actor: me }]), [], "events not drawn are left out");

const labels = entries([
  { event: "labeled", actor: me, created_at: at(1), label: bug },
  { event: "labeled", actor: me, created_at: at(2), label: ui },
  { event: "unlabeled", actor: me, created_at: at(3), label: ui },
  { event: "labeled", actor: bob, created_at: at(4), label: ui },
]);
assert.equal(labels.length, 2, "ana's run is one line, bob's another");
assert.deepEqual(labels[0].labels, { added: [bug], removed: [] }, "added then removed cancels out");
const undone = entries([{ event: "labeled", actor: me, label: bug }, { event: "unlabeled", actor: me, label: bug }]);
assert.deepEqual(undone, [], "a label added and removed at once leaves no line");

const pr = entries([
  { event: "committed", sha: "0123456789", message: "fix: thing\n\nbody", html_url: "u", author: { name: "Ana", date: at(1) } },
  { event: "reviewed", user: bob, state: "commented", body: "", submitted_at: at(2) },
  { event: "reviewed", user: bob, state: "changes_requested", body: "", submitted_at: at(3) },
  { event: "merged", actor: me, commit_id: "abcdef1234", created_at: at(4) },
  { event: "closed", actor: me, created_at: at(4) },
]);
assert.deepEqual(pr.map((x) => x.card ?? Object.keys(x).find((k) => ["commit", "merged", "closed"].includes(k))), ["commit", "review", "merged"], "empty comment-review dropped; merge hides its close");
assert.deepEqual(pr[0].commit, { sha: "0123456", url: "u", message: "fix: thing" }, "commit: short sha, first line");
assert.equal(pr[0].who, "Ana", "commit author by name");
assert.equal(pr[1].review, "CHANGES_REQUESTED", "review state upper-cased");

const closed = entries([{ event: "closed", actor: me, state_reason: "not_planned" }, { event: "reopened", actor: me }, { event: "closed", actor: me }]);
assert.deepEqual(closed.map((x) => x.closed ?? "reopened"), ["not_planned", "reopened", "completed"], "close reasons, reopen");
assert.equal(entries([{ event: "commented", actor: null, body: "x" }])[0].who, "ghost", "deleted account");
assert.equal(entries([{ event: "cross-referenced", actor: me, source: {} }]).length, 0, "reference without its issue");
assert.equal(entries([{ event: "referenced", actor: me, commit_id: "abc", commit_url: "https://api.github.com/repos/o/r/commits/abc" }])[0].commit.url, "https://github.com/o/r/commit/abc", "commit referenced from another push");

assert.deepEqual(tally([{ content: "THUMBS_UP", users: { totalCount: 3 } }, { content: "EYES", users: { totalCount: 0 } }]), ["👍 3"], "GraphQL groups, zero dropped");
assert.deepEqual(tally({ "+1": 2, heart: 1, total_count: 3, url: "x" }), ["👍 2", "❤️ 1"], "REST reactions object");
assert.deepEqual(tally(undefined), [], "no reactions");
console.log("timeline.test ok");
