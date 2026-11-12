// Context menus and action dialogs, as in VS Code's Git Graph.
// A menu item is { label, action } (opens a dialog) or { label, now } (runs at once),
// or "-" (a separator). An action is { title, text, fields, steps(values) -> git argv[] }.

const short = (h) => (h ?? "").slice(0, 8);

export function menuItems(kind, t, ctx) {
  const cur = ctx.headBranch;
  if (kind === "commit") return [
    { label: "Add Tag…", action: "addTag" },
    { label: "Create Branch…", action: "createBranch" },
    "-",
    { label: "Checkout…", action: "checkoutCommit" },
    { label: "Cherry Pick…", action: "cherryPick", hidden: t.parents.length === 0 },
    { label: "Revert…", action: "revert", hidden: t.parents.length === 0 },
    { label: "Drop…", action: "drop", hidden: t.parents.length !== 1 },
    "-",
    { label: "Merge into current branch…", action: "mergeCommit", hidden: !cur },
    { label: "Rebase current branch on this Commit…", action: "rebaseCommit", hidden: !cur },
    { label: "Reset current branch to this Commit…", action: "reset", hidden: !cur },
    "-",
    { label: "Copy Commit Hash to Clipboard", now: "copy", value: t.hash },
    { label: "Copy Commit Subject to Clipboard", now: "copy", value: t.subject },
  ];
  if (kind === "head") return [
    { label: "Checkout Branch", now: "checkout", hidden: t.name === cur },
    { label: "Rename Branch…", action: "renameBranch" },
    { label: "Delete Branch…", action: "deleteBranch", hidden: t.name === cur },
    "-",
    { label: "Merge into current branch…", action: "mergeBranch", hidden: !cur || t.name === cur },
    { label: "Rebase current branch on Branch…", action: "rebaseBranch", hidden: !cur || t.name === cur },
    { label: "Push Branch…", action: "pushBranch", hidden: !ctx.remotes.length },
    "-",
    { label: "Copy Branch Name to Clipboard", now: "copy", value: t.name },
  ];
  if (kind === "remote") return [
    { label: "Checkout Branch…", action: "checkoutRemote" },
    { label: "Delete Remote Branch…", action: "deleteRemote" },
    { label: "Fetch into local branch…", action: "fetchInto" },
    "-",
    { label: "Merge into current branch…", action: "mergeBranch", hidden: !cur },
    { label: "Pull into current branch…", action: "pullInto", hidden: !cur },
    "-",
    { label: "Copy Branch Name to Clipboard", now: "copy", value: t.name },
  ];
  if (kind === "tag") return [
    { label: "Delete Tag…", action: "deleteTag" },
    { label: "Push Tag…", action: "pushTag", hidden: !ctx.remotes.length },
    "-",
    { label: "Copy Tag Name to Clipboard", now: "copy", value: t.name },
  ];
  if (kind === "stash") return [
    { label: "Apply Stash…", action: "applyStash" },
    { label: "Pop Stash…", action: "popStash" },
    { label: "Drop Stash…", action: "dropStash" },
    { label: "Create Branch from Stash…", action: "branchStash" },
    "-",
    { label: "Copy Stash Name to Clipboard", now: "copy", value: t.stash },
    { label: "Copy Stash Hash to Clipboard", now: "copy", value: t.hash },
  ];
  if (kind === "uncommitted") return [
    { label: "Stash uncommitted changes…", action: "stash" },
    { label: "Reset uncommitted changes…", action: "resetUncommitted" },
    { label: "Clean untracked files…", action: "clean" },
    "-",
    { label: "Open terminal here", now: "terminal" },
  ];
  return [];
}

const check = (key, label, value = false) => ({ type: "check", key, label, value });
const text = (key, label, value = "", placeholder = "") => ({ type: "text", key, label, value, placeholder });
const radio = (key, label, options, value) => ({ type: "radio", key, label, options, value: value ?? options[0][0] });

export function action(name, target, ctx) {
  const t = target ?? {}, P = t.parents ?? [];
  const cur = ctx.headBranch, remote0 = ctx.remotes[0] ?? "origin";
  const remoteField = (v) => radio("remote", "Remote", ctx.remotes.map((r) => [r, r]), v);
  const A = {
    addTag: {
      title: "Add Tag", text: `Add tag to commit ${short(t.hash)}:`,
      fields: [text("name", "Name", "", "v1.0.0"), radio("type", "Type", [["annotated", "Annotated"], ["light", "Lightweight"]]), text("message", "Message (annotated)", ""), check("push", `Push to remote${ctx.remotes.length ? ` (${remote0})` : ""}`)],
      steps: (v) => [v.type === "light" ? ["tag", v.name, t.hash] : ["tag", "-a", v.name, "-m", v.message || v.name, t.hash], ...(v.push ? [["push", remote0, `refs/tags/${v.name}`]] : [])],
      need: ["name"],
    },
    createBranch: {
      title: "Create Branch", text: `Create branch at commit ${short(t.hash)}:`,
      fields: [text("name", "Name", "", "feature/x"), check("checkout", "Check out", true)],
      steps: (v) => [v.checkout ? ["checkout", "-b", v.name, t.hash] : ["branch", v.name, t.hash]], need: ["name"],
    },
    checkoutCommit: { title: "Checkout Commit", text: `Check out commit ${short(t.hash)}? This puts the repository in a detached HEAD state.`, fields: [], steps: () => [["checkout", t.hash]] },
    cherryPick: {
      title: "Cherry Pick", text: `Cherry pick commit ${short(t.hash)} onto ${cur ?? "HEAD"}?`,
      fields: [check("x", "Record origin (-x)"), check("nocommit", "No commit"), ...(P.length > 1 ? [text("parent", "Mainline parent number", "1")] : [])],
      steps: (v) => [["cherry-pick", ...(v.x ? ["-x"] : []), ...(v.nocommit ? ["--no-commit"] : []), ...(P.length > 1 ? ["-m", v.parent || "1"] : []), t.hash]],
    },
    revert: {
      title: "Revert", text: `Revert commit ${short(t.hash)}?`,
      fields: P.length > 1 ? [text("parent", "Mainline parent number", "1")] : [],
      steps: (v) => [["revert", "--no-edit", ...(P.length > 1 ? ["-m", v.parent || "1"] : []), t.hash]],
    },
    drop: {
      title: "Drop Commit", danger: true, text: `Drop commit ${short(t.hash)} from ${cur ?? "HEAD"}? It is removed by rebasing the commits above it.`,
      fields: [], steps: () => [["rebase", "--onto", P[0], t.hash]],
    },
    mergeCommit: {
      title: "Merge Commit", text: `Merge commit ${short(t.hash)} into ${cur}?`,
      fields: [check("noff", "Create a new commit even if fast-forward is possible", true), check("squash", "Squash commits"), check("nocommit", "No commit")],
      steps: (v) => [["merge", ...(v.noff && !v.squash ? ["--no-ff"] : []), ...(v.squash ? ["--squash"] : []), ...(v.nocommit && !v.squash ? ["--no-commit"] : []), ...(!v.nocommit && !v.squash ? ["--no-edit"] : []), t.hash]],
    },
    mergeBranch: {
      title: "Merge Branch", text: `Merge ${t.type === "remote" ? "remote branch" : "branch"} ${t.name} into ${cur}?`,
      fields: [check("noff", "Create a new commit even if fast-forward is possible", true), check("squash", "Squash commits"), check("nocommit", "No commit")],
      steps: (v) => [["merge", ...(v.noff && !v.squash ? ["--no-ff"] : []), ...(v.squash ? ["--squash"] : []), ...(v.nocommit && !v.squash ? ["--no-commit"] : []), ...(!v.nocommit && !v.squash ? ["--no-edit"] : []), t.name]],
    },
    rebaseCommit: {
      title: "Rebase", danger: true, text: `Rebase ${cur} on commit ${short(t.hash)}?`,
      fields: [check("ignoreDate", "Ignore date (--ignore-date)")],
      steps: (v) => [["rebase", ...(v.ignoreDate ? ["--ignore-date"] : []), t.hash]],
    },
    rebaseBranch: {
      title: "Rebase", danger: true, text: `Rebase ${cur} on branch ${t.name}?`,
      fields: [check("ignoreDate", "Ignore date (--ignore-date)")],
      steps: (v) => [["rebase", ...(v.ignoreDate ? ["--ignore-date"] : []), t.name]],
    },
    reset: {
      title: "Reset", danger: true, text: `Reset ${cur} to commit ${short(t.hash)}?`,
      fields: [radio("mode", "Mode", [["soft", "Soft — keep all changes, staged"], ["mixed", "Mixed — keep working tree, reset index"], ["hard", "Hard — discard all changes"]], "mixed")],
      steps: (v) => [["reset", `--${v.mode}`, t.hash]],
    },
    renameBranch: {
      title: "Rename Branch", text: `Rename branch ${t.name}:`, fields: [text("name", "New name", t.name)],
      steps: (v) => [["branch", "-m", t.name, v.name]], need: ["name"],
    },
    deleteBranch: {
      title: "Delete Branch", danger: true, text: `Delete branch ${t.name}?`,
      fields: [check("force", "Force delete (even if not merged)"), ...ctx.remotes.filter((r) => ctx.remoteBranches.includes(`${r}/${t.name}`)).map((r) => check(`remote:${r}`, `Delete on remote ${r} too`))],
      steps: (v) => [["branch", v.force ? "-D" : "-d", t.name], ...ctx.remotes.filter((r) => v[`remote:${r}`]).map((r) => ["push", r, "--delete", t.name])],
    },
    pushBranch: {
      title: "Push Branch", text: `Push branch ${t.name}:`,
      fields: [remoteField(t.upstream?.split("/")[0] ?? remote0), check("upstream", "Set upstream", !t.upstream), radio("force", "Push mode", [["normal", "Normal"], ["lease", "Force with lease"], ["force", "Force"]], "normal")],
      steps: (v) => [["push", ...(v.upstream ? ["--set-upstream"] : []), ...(v.force === "lease" ? ["--force-with-lease"] : v.force === "force" ? ["--force"] : []), v.remote, t.name]],
    },
    checkoutRemote: {
      title: "Checkout Remote Branch", text: `Create a local branch tracking ${t.name}:`,
      fields: [text("name", "Local branch name", t.short ?? t.name)],
      steps: (v) => [ctx.branches.includes(v.name) ? ["checkout", v.name] : ["checkout", "-b", v.name, "--track", t.name]], need: ["name"],
    },
    deleteRemote: {
      title: "Delete Remote Branch", danger: true, text: `Delete branch ${t.short} on remote ${t.remote}?`,
      fields: [], steps: () => [["push", t.remote, "--delete", t.short]],
    },
    fetchInto: {
      title: "Fetch into Local Branch", text: `Fetch ${t.name} into a local branch:`,
      fields: [text("name", "Local branch", t.short ?? t.name), check("force", "Force fetch")],
      steps: (v) => [["fetch", ...(v.force ? ["-f"] : []), t.remote, `${t.short}:${v.name}`]], need: ["name"],
    },
    pullInto: {
      title: "Pull into Current Branch", text: `Pull ${t.name} into ${cur}?`,
      fields: [check("noff", "Create a new commit even if fast-forward is possible"), check("squash", "Squash commits")],
      steps: (v) => [["pull", "--no-edit", ...(v.noff ? ["--no-ff"] : []), ...(v.squash ? ["--squash"] : []), t.remote, t.short]],
    },
    deleteTag: {
      title: "Delete Tag", danger: true, text: `Delete tag ${t.name}?`,
      fields: ctx.remotes.length ? [check("remote", `Delete on remote ${remote0} too`)] : [],
      steps: (v) => [["tag", "-d", t.name], ...(v.remote ? [["push", remote0, "--delete", `refs/tags/${t.name}`]] : [])],
    },
    pushTag: {
      title: "Push Tag", text: `Push tag ${t.name}:`, fields: [remoteField(remote0)],
      steps: (v) => [["push", v.remote, `refs/tags/${t.name}`]],
    },
    stash: {
      title: "Stash Uncommitted Changes", text: "Stash the uncommitted changes:",
      fields: [text("message", "Message", ""), check("untracked", "Include untracked", true)],
      steps: (v) => [["stash", "push", ...(v.untracked ? ["--include-untracked"] : []), ...(v.message ? ["-m", v.message] : [])]],
    },
    resetUncommitted: {
      title: "Reset Uncommitted Changes", danger: true, text: "Reset the uncommitted changes to HEAD?",
      fields: [radio("mode", "Mode", [["mixed", "Mixed — unstage, keep working tree"], ["hard", "Hard — discard all tracked changes"]], "mixed")],
      steps: (v) => [["reset", `--${v.mode}`, "HEAD"]],
    },
    clean: {
      title: "Clean Untracked Files", danger: true, text: "Delete all untracked files?",
      fields: [check("dirs", "Also directories (-d)", true)], steps: (v) => [["clean", "-f", ...(v.dirs ? ["-d"] : [])]],
    },
    applyStash: {
      title: "Apply Stash", text: `Apply ${t.stash}?`, fields: [check("index", "Reinstate index")],
      steps: (v) => [["stash", "apply", ...(v.index ? ["--index"] : []), t.stash]],
    },
    popStash: {
      title: "Pop Stash", text: `Pop ${t.stash}?`, fields: [check("index", "Reinstate index")],
      steps: (v) => [["stash", "pop", ...(v.index ? ["--index"] : []), t.stash]],
    },
    dropStash: { title: "Drop Stash", danger: true, text: `Drop ${t.stash}? It can't be recovered from Git Graph.`, fields: [], steps: () => [["stash", "drop", t.stash]] },
    branchStash: {
      title: "Create Branch from Stash", text: `Create a branch from ${t.stash}:`, fields: [text("name", "Name", "")],
      steps: (v) => [["stash", "branch", v.name, t.stash]], need: ["name"],
    },
    fetch: {
      title: "Fetch", text: "Fetch from all remotes?", fields: [check("prune", "Prune deleted remote branches", true)],
      steps: (v) => [["fetch", "--all", ...(v.prune ? ["--prune"] : [])]],
    },
  };
  return A[name];
}
