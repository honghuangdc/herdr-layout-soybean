// Git for the graph: reading the repo (no writes under .git) and running actions.
import { exec, readTextFile } from "herdr";

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "log.showSignature=false", "-c", "core.quotepath=false"];
const US = "\x1f", RS = "\x1e";

export async function git(repo, args, { write = false, timeout } = {}) {
  const r = await exec("git", write ? args : [...READ, ...args], { cwd: repo.root, on: repo.on, ...(timeout ? { timeout } : {}) });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim());
  return r.stdout;
}

/** The superproject (or this repo) first, then its initialized submodules, as Git Graph's Repo list. */
export async function listRepos(root, on) {
  const sup = await exec("git", ["rev-parse", "--show-superproject-working-tree"], { cwd: root, on });
  const base = (sup.code === 0 && sup.stdout.trim()) || root;
  const st = await exec("git", [...READ, "submodule", "status", "--recursive"], { cwd: base, on });
  const subs = st.code === 0 ? st.stdout.split("\n").filter((l) => l && l[0] !== "-").map((l) => l.slice(1).split(" ")[1]).filter(Boolean) : [];
  return [base, ...subs.map((p) => `${base}/${p}`)];
}

export async function findRoot(cwd, on) {
  const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Everything the table needs. opts: { remotes: bool, branches: string[] | null, max } */
export async function loadRepo(repo, opts) {
  const [refsOut, headOut, symOut, statusOut, remotesOut] = await Promise.all([
    git(repo, ["for-each-ref", `--format=%(objectname)${US}%(*objectname)${US}%(refname)${US}%(upstream:short)`, "refs/heads", "refs/remotes", "refs/tags"]),
    exec("git", [...READ, "rev-parse", "--verify", "-q", "HEAD"], { cwd: repo.root, on: repo.on }),
    exec("git", [...READ, "symbolic-ref", "-q", "--short", "HEAD"], { cwd: repo.root, on: repo.on }),
    git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(repo, ["remote"]),
  ]);
  const head = headOut.code === 0 ? headOut.stdout.trim() : null;
  const headBranch = symOut.code === 0 ? symOut.stdout.trim() : null;
  const remotes = remotesOut.split("\n").map((s) => s.trim()).filter(Boolean);

  const refs = {}; // hash -> [{ type: head|remote|tag, name, remote? }]
  const branches = [], remoteBranches = [], tags = [];
  for (const line of refsOut.split("\n")) {
    if (!line) continue;
    const [obj, peeled, ref, upstream] = line.split(US);
    const hash = peeled || obj;
    let r;
    if (ref.startsWith("refs/heads/")) { r = { type: "head", name: ref.slice(11), upstream }; branches.push(r.name); }
    else if (ref.startsWith("refs/remotes/")) {
      const name = ref.slice(13);
      if (name.endsWith("/HEAD")) continue;
      const remote = remotes.find((x) => name.startsWith(x + "/")) ?? name.split("/")[0];
      r = { type: "remote", name, remote, short: name.slice(remote.length + 1) };
      remoteBranches.push(name);
    } else { r = { type: "tag", name: ref.slice(10) }; tags.push(r.name); if (!opts.tags) continue; }
    (refs[hash] ??= []).push(r);
  }

  const spec = opts.branches?.length ? opts.branches : ["--branches", ...(opts.tags ? ["--tags"] : []), ...(opts.remotes ? ["--remotes"] : [])];
  const logArgs = ["log", "--date-order", ...(opts.firstParent ? ["--first-parent"] : []), ...(opts.reflog ? ["--reflog"] : []), `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%s${RS}`, "-n", String(opts.max + 1), ...spec, ...(head ? ["HEAD"] : []), "--"];
  const logOut = head || branches.length ? await git(repo, logArgs) : "";
  const commits = [];
  for (const rec of logOut.split(RS)) {
    const t = rec.replace(/^\n/, "");
    if (!t) continue;
    const [hash, parents, author, email, date, subject] = t.split(US);
    commits.push({ hash, parents: parents ? parents.split(" ") : [], author, email, date: Number(date), subject });
  }
  const more = commits.length > opts.max;
  if (more) commits.length = opts.max;

  const changes = parseStatus(statusOut);
  // Stashes, as Git Graph shows them: a row just above the commit they were made on.
  if (opts.stashes) {
    const st = await exec("git", [...READ, "stash", "list", `--format=%H${US}%P${US}%gd${US}%an${US}%ae${US}%at${US}%s`], { cwd: repo.root, on: repo.on });
    const stashes = st.code === 0 ? st.stdout.split("\n").filter(Boolean).map((l) => l.split(US)) : [];
    for (const [hash, parents, name, author, email, date, subject] of stashes.reverse()) {
      const p0 = parents.split(" ")[0], at = commits.findIndex((c) => c.hash === p0);
      if (at >= 0) commits.splice(at, 0, { hash, parents: [p0], author, email, date: Number(date), subject, stash: name });
    }
  }
  return { head, headBranch, remotes, refs, branches, remoteBranches, tags, commits, more, changes };
}

function parseStatus(out) {
  const files = [], parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const xy = e.slice(0, 2), path = e.slice(3);
    let old = null;
    if (xy[0] === "R" || xy[0] === "C") old = parts[++i];
    const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
    const status = conflict ? "U" : xy === "??" ? "U?" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : xy[0] === "R" ? "R" : "M";
    files.push({ path, old, status: status === "U?" ? "A" : status, untracked: xy === "??", conflict });
  }
  return files;
}

/** Full commit info: body, committer and parents. */
export async function commitInfo(repo, hash) {
  const out = await git(repo, ["show", "-s", `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%cn${US}%ce${US}%ct${US}%B`, hash]);
  const [h, parents, an, ae, at, cn, ce, ct, ...body] = out.split(US);
  return { hash: h, parents: parents ? parents.split(" ") : [], author: an, email: ae, date: Number(at), committer: cn, cemail: ce, cdate: Number(ct), body: body.join(US).trim() };
}

/** Changed files between two commits (from null = the root commit; to null = the working tree). */
export async function changedFiles(repo, from, to) {
  const range = to ? (from ? [from, to] : null) : [from ?? "HEAD"];
  const nameArgs = range ? ["diff", "--name-status", "-z", "-M", ...range] : ["diff-tree", "--root", "-r", "--name-status", "-z", "-M", "--no-commit-id", to];
  const numArgs = range ? ["diff", "--numstat", "-z", "-M", ...range] : ["diff-tree", "--root", "-r", "--numstat", "-z", "-M", "--no-commit-id", to];
  const [names, nums] = await Promise.all([git(repo, nameArgs), git(repo, numArgs)]);
  const files = [];
  const n = names.split("\0");
  for (let i = 0; i < n.length; i++) {
    const s = n[i];
    if (!s) continue;
    const code = s[0];
    if (code === "R" || code === "C") { files.push({ status: "R", old: n[i + 1], path: n[i + 2], add: 0, del: 0 }); i += 2; }
    else { files.push({ status: code === "T" ? "M" : code, path: n[i + 1], add: 0, del: 0 }); i += 1; }
  }
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  const t = nums.split("\0");
  for (let i = 0; i < t.length; i++) {
    if (!t[i]) continue;
    const [a, d, path] = t[i].split("\t");
    let p = path;
    if (path === "") { p = t[i + 2]; i += 2; } // rename: "a\td\t" NUL old NUL new
    const f = byPath[p];
    if (f) { f.add = Number(a) || 0; f.del = Number(d) || 0; f.binary = a === "-"; }
  }
  return files;
}

/** Diff text of one file; from/to as in changedFiles. */
export async function fileDiff(repo, from, to, file) {
  if (!to && file.untracked) {
    const text = await readTextFile(`${repo.root}/${file.path}`, { on: repo.on }).catch(() => null);
    if (text === null) return ["Cannot preview this file (binary, too large, or unreadable)"];
    if (text.includes("\0")) return ["Binary file · no text diff"];
    const lines = text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 3000);
    return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)];
  }
  const paths = file.old ? [file.old, file.path] : [file.path];
  const args = to ? (from ? ["diff", "-M", from, to] : ["diff-tree", "-p", "-M", "--root", to]) : ["diff", "-M", from ?? "HEAD"];
  const out = await git(repo, [...args, "--no-ext-diff", "--no-textconv", "--no-color", "--", ...paths]);
  const all = out.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return [file.binary ? "Binary file changed" : "No text diff available"];
  return all.slice(first, first + 3000).map((l) => (l.length > 4000 ? l.slice(0, 4000) + "… (line truncated)" : l));
}

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

/** Numbers each diff line once, so a frame only draws the rows on screen. */
export function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, old: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") return { kind, old: old++, number: next++, text: untab(line.slice(1)) || " " };
    return { kind: "", text: line };
  });
}

/** Runs action steps in order; stops at the first failure. Steps: string[] (git args). */
export async function runSteps(repo, steps) {
  for (const args of steps) await git(repo, args, { write: true, timeout: 120000 });
}

export async function copyText(text) {
  await exec("sh", ["-c", 'printf %s "$1" | pbcopy', "_", text]);
}
