// node mods/github/worktree.test.mjs : prepareWorktree (actions.js) against a real clone and its origin, with a stand-in for herdr.
import { registerHooks } from "module";
import assert from "assert";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const top = mkdtempSync(join(tmpdir(), "herdr-wt-"));
const stub = `import { execFile } from "child_process";
export const exec = (cmd, args = [], { cwd } = {}) => new Promise((ok) => execFile(cmd, args, { cwd }, (e, stdout, stderr) => ok({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr })));
export const home = () => ${JSON.stringify(join(top, "home"))};
const none = () => null; export { none as run, none as notify, none as openOverlay, none as closeOverlay, none as setShared };
export const knownAgents = async () => [], spaces = () => [], panes = () => [], agents = () => [], shared = () => null;`;
registerHooks({ resolve: (spec, ctx, next) => spec === "herdr" ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true }
  : spec === "gpui-kit" || spec === "gpui-base" ? { url: `data:text/javascript,${encodeURIComponent("const f = () => new Proxy(() => f(), { get: () => f }); export const div = f, svg = f, image = f, v_flex = f, h_flex = f;")}`, shortCircuit: true }
  : next(spec, ctx) });
const { prepareWorktree, removeWorktree } = await import("./actions.js");

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
try {
  const origin = join(top, "origin.git"), clone = join(top, "clone");
  sh(top, "init", "-q", "--bare", "-b", "main", origin); sh(top, "clone", "-q", origin, clone);
  sh(clone, "config", "user.email", "t@t"); sh(clone, "config", "user.name", "t");
  writeFileSync(join(clone, "a"), "1\n"); sh(clone, "add", "a"); sh(clone, "commit", "-qm", "one"); sh(clone, "push", "-q", "origin", "main"); sh(clone, "remote", "set-head", "origin", "main");
  writeFileSync(join(clone, "a"), "dirty\n"); // the clone's own uncommitted work is left alone

  const task = { folder: clone, ref: "me/proj#12", work: { kind: "issue", number: 12, title: "Export a note", labels: ["bug"] } };
  const wt = await prepareWorktree(task);
  assert.deepEqual(wt, { folder: join(top, "home/.herdr/worktrees/proj/me-issue-12"), branch: "fix/12-export-a-note", base: "origin/main", from: "origin/main", reused: false });
  assert.equal(sh(wt.folder, "rev-parse", "--abbrev-ref", "HEAD"), "fix/12-export-a-note");
  assert.equal(sh(clone, "status", "--porcelain"), "M a", "the clone keeps its changes and its branch");
  assert.equal(sh(clone, "rev-parse", "--abbrev-ref", "HEAD"), "main");

  const again = await prepareWorktree(task);
  assert.equal(again.folder, wt.folder); assert.equal(again.reused, true, "a second start reuses it");

  // The branch exists but its worktree was removed: checked out again, not recreated.
  sh(clone, "worktree", "remove", "--force", wt.folder);
  const back = await prepareWorktree(task);
  assert.equal(back.reused, true); assert.equal(back.base, null); assert.equal(back.from, null); assert.ok(existsSync(back.folder));

  // Deleted by hand (rm -rf, not git worktree remove): pruned and made again, not handed out as a missing folder.
  rmSync(back.folder, { recursive: true, force: true });
  const made = await prepareWorktree(task);
  assert.ok(existsSync(made.folder)); assert.equal(made.branch, "fix/12-export-a-note");

  // A reused worktree reports the branch it is really on.
  sh(made.folder, "checkout", "-q", "-b", "pr-12");
  assert.equal((await prepareWorktree(task)).branch, "pr-12");

  // A pull request gh can't check out (no GitHub here): nothing is left behind for a retry to reuse.
  const pr = { ...task, ref: "me/proj#5", work: { kind: "pr", number: 5, title: "x", headRefName: "topic" } };
  await assert.rejects(prepareWorktree(pr));
  assert.ok(!existsSync(join(top, "home/.herdr/worktrees/proj/me-pr-5")));
  assert.ok(!sh(clone, "worktree", "list").includes("me-pr-5"));

  // No origin/HEAD (offline, or never set): the clone's current branch is the base.
  sh(clone, "remote", "set-head", "origin", "--delete"); sh(clone, "config", "remote.origin.followRemoteHEAD", "never"); // git ≥ 2.48 would recreate it on fetch
  const other = await prepareWorktree({ ...task, ref: "me/proj#13", work: { kind: "issue", number: 13, title: "Other", labels: [] } });
  assert.equal(other.base, "main"); assert.equal(other.from, "main", "Changes counts from main here"); assert.equal(other.branch, "feat/13-other");

  { // removeWorktree, on a fresh clone with origin/HEAD.
    const up = join(top, "up.git"), c = join(top, "c");
    sh(top, "init", "-q", "--bare", "-b", "main", up); sh(top, "clone", "-q", up, c);
    sh(c, "config", "user.email", "t@t"); sh(c, "config", "user.name", "t");
    writeFileSync(join(c, "a"), "1\n"); sh(c, "add", "a"); sh(c, "commit", "-qm", "one"); sh(c, "push", "-q", "origin", "main"); sh(c, "remote", "set-head", "origin", "main");
    const start = async (n) => {
      const w = await prepareWorktree({ folder: c, ref: `me/c#${n}`, work: { kind: "issue", number: n, title: `t${n}`, labels: [] } });
      writeFileSync(join(w.folder, `f${n}`), "x\n"); sh(w.folder, "add", "-A"); sh(w.folder, "commit", "-qm", `work ${n}`);
      return w;
    };
    const branches = () => sh(c, "branch", "--format=%(refname:short)").split("\n");

    // Merged on origin (a merge commit pushed by someone else): worktree and branch go.
    const m = await start(1);
    sh(c, "push", "-q", "origin", m.branch); sh(c, "fetch", "-q", "origin");
    const other = join(top, "other"); sh(top, "clone", "-q", up, other); sh(other, "config", "user.email", "t@t"); sh(other, "config", "user.name", "t");
    sh(other, "merge", "-q", "--no-ff", "-m", "merge 1", `origin/${m.branch}`); sh(other, "push", "-q", "origin", "main");
    assert.deepEqual(await removeWorktree(m), { branch: "feat/1-t1", base: "origin/main", deleted: true });
    assert.ok(!existsSync(m.folder)); assert.ok(!branches().includes("feat/1-t1")); assert.ok(!sh(c, "worktree", "list").includes("me-issue-1"));

    // Not in origin/main (squash merge, or closed unmerged): the worktree goes, the branch and its commit stay.
    const u = await start(2);
    assert.deepEqual(await removeWorktree(u), { branch: "feat/2-t2", base: "origin/main", deleted: false });
    assert.ok(!existsSync(u.folder)); assert.ok(branches().includes("feat/2-t2"));
    assert.equal(sh(c, "log", "-1", "--format=%s", "feat/2-t2"), "work 2");

    // Uncommitted changes: refused, nothing touched.
    const d = await start(3); writeFileSync(join(d.folder, "f3"), "edited\n"); writeFileSync(join(d.folder, "new"), "n\n");
    await assert.rejects(removeWorktree(d), /modified or untracked/);
    assert.ok(existsSync(join(d.folder, "new"))); assert.ok(branches().includes("feat/3-t3"));

    // Deleted by hand already: nothing to do, no error.
    const g = await start(4); rmSync(g.folder, { recursive: true, force: true });
    assert.deepEqual(await removeWorktree(g), { gone: true });
    assert.deepEqual(await removeWorktree({ folder: join(top, "never-existed") }), { gone: true });

    // Detached (a pull request checked out without a branch): the worktree goes, no branch to delete.
    const h = await start(5); sh(h.folder, "checkout", "-q", "--detach");
    assert.deepEqual(await removeWorktree(h), { branch: null, deleted: false }); assert.ok(!existsSync(h.folder));
    assert.equal(sh(c, "status", "--porcelain"), "", "the clone itself is untouched");
  }
} finally { rmSync(top, { recursive: true, force: true }); }
console.log("worktree ok");
