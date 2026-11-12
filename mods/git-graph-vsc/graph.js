// Lanes for the commit graph, the way VS Code's Git Graph lays them out, and
// the per-row drawing (PathBuilder + window.paint_path).
import { div, PathBuilder } from "gpui-kit";

export const COLORS = ["#0085d9", "#d9008f", "#00d90a", "#d98500", "#a300d9", "#ff0000", "#00d9cc", "#e138e8", "#85d900", "#dc5b23", "#6f24d6", "#ffcc00"];
export const LANE = 16;
export const ROW = 24;
const R = 4;
const STROKE = 2;

/**
 * commits: [{ hash, parents }] newest first (the uncommitted row first, if any).
 * Returns one entry per commit:
 *   { lane, color, before: [{hash,color}|null], after: [...], merges: [{lane,color}], root }
 * and the widest lane count.
 */
export function layoutGraph(commits) {
  const lanes = [];
  let next = 0, width = 0;
  // Like Git Graph: a new branch takes the first color no live lane is using.
  const color = () => {
    const used = new Set(lanes.filter(Boolean).map((l) => l.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[next++ % COLORS.length];
  };
  const free = (skip) => { for (let i = 0; i < lanes.length; i++) if (!lanes[i] && i !== skip) return i; return lanes.length; };
  const rows = commits.map((c) => {
    const waiting = [];
    lanes.forEach((l, i) => { if (l && l.hash === c.hash) waiting.push(i); });
    let lane;
    if (waiting.length) lane = waiting[0];
    else { lane = free(-1); lanes[lane] = { hash: c.hash, color: color() }; }
    const own = lanes[lane].color;
    const before = lanes.slice();
    if (!waiting.length) before[lane] = null; // a branch tip: nothing comes in from above
    for (const i of waiting) if (i !== lane) lanes[i] = null;
    const merges = [];
    if (!c.parents.length) lanes[lane] = null;
    else {
      lanes[lane] = { hash: c.parents[0], color: own };
      for (const p of c.parents.slice(1)) {
        let target = lanes.findIndex((l) => l && l.hash === p);
        if (target < 0) { target = free(lane); lanes[target] = { hash: p, color: color() }; merges.push({ lane: target, color: lanes[target].color, fresh: true }); }
        else merges.push({ lane: target, color: lanes[target].color, fresh: false });
      }
    }
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
    const after = lanes.slice();
    width = Math.max(width, before.length, after.length, lane + 1);
    return { hash: c.hash, lane, color: own, before, after, merges, root: !c.parents.length };
  });
  return { rows, width };
}

const x = (lane) => lane * LANE + LANE / 2 + 4;

function circle(b, cx, cy, r) {
  return b.move_to(cx + r, cy).arc_to(r, r, 0, false, true, cx - r, cy).arc_to(r, r, 0, false, true, cx + r, cy).close();
}

/**
 * The graph cell of one row. `head`: this commit is HEAD (hollow dot), `pending`:
 * the uncommitted-changes row (grey, dashed). `bg`: the row background for hollow dots.
 */
export function graphCell(row, width, { head, pending, stash, bg, muted }) {
  const H = ROW, mid = H / 2;
  // Segments per color; PathBuilder is chained (each call may return a new builder).
  const groups = new Map();
  const add = (color, dashed, seg) => {
    const k = color + (dashed ? "-d" : "");
    if (!groups.has(k)) groups.set(k, { color, dashed, segs: [] });
    groups.get(k).segs.push(seg);
  };
  const nodeX = x(row.lane);
  row.before.forEach((l, i) => {
    if (!l) return;
    // A lane waiting for this commit bends into its dot; every other lane passes by.
    if (l.hash === row.hash) add(l.color, false, [x(i), 0, nodeX, mid]);
    else add(l.color, false, [x(i), 0, x(i), H]);
  });
  if (!row.root) add(pending ? muted : row.color, pending, [nodeX, mid, nodeX, H]);
  for (const m of row.merges) add(m.color, false, [nodeX, mid, x(m.lane), H]);
  const layer = (path, color) => globalThis.window.paint_path(path, color).absolute().top(0).left(0).size_full();
  const layers = [];
  for (const { color, dashed, segs } of groups.values()) {
    let b = PathBuilder.stroke(STROKE);
    if (dashed) b = b.dash_array([2, 2]);
    for (const [x1, y1, x2, y2] of segs) {
      b = b.move_to(x1, y1);
      if (x1 === x2) b = b.line_to(x2, y2);
      else { const d = (y2 - y1) * 0.6; b = b.cubic_bezier_to(x2, y2, x1, y1 + d, x2, y2 - d); }
    }
    layers.push(layer(b.build(), color));
  }
  const dot = pending ? muted : row.color;
  if (pending || stash) {
    layers.push(layer(circle(PathBuilder.fill(), nodeX, mid, R).build(), bg));
    layers.push(layer(circle(PathBuilder.stroke(STROKE), nodeX, mid, R - 0.5).build(), dot));
  } else layers.push(layer(circle(PathBuilder.fill(), nodeX, mid, R).build(), dot));
  return div().relative().w(graphWidth(width)).h(H).flex_none().overflow_hidden().children(layers);
}

export const graphWidth = (lanes) => Math.max(1, lanes) * LANE + 8;
