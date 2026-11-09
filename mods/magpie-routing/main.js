// Routing: magpie's live gateway stage, redrawn from plugins/routing/routing.css
// (rtflow's 8px/.7s dashes, rtlive's 1.8s dot, rtflap's .42s beat) with native
// herdr loops. Data comes from magpie's own ~/.config/magpie/routing/<date>.jsonl.
// Panel chrome mirrors agentee-agents / agentee-system: 30px header, rounded(8)
// root, p(8).gap(8) body, rounded(6) cards on t.canvas / t.surface / t.raised.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme } from "herdr";

const WIRE = "mods/magpie-routing/wire.svg";
const BIRD = "mods/magpie-routing/bird.svg";

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function msLabel(v) {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

function section(t, title, subtitle = null, right = null) {
  return h_flex().w_full().items_center().gap(6)
    .child(div().text_size(9.5).font_medium().text_color(t.dim).child(String(title).toUpperCase()))
    .when(Boolean(subtitle), (el) => el.child(div().min_w(0).truncate().text_size(9.5).text_color(t.dim).child(subtitle)))
    .child(div().flex_1())
    .when(Boolean(right), (el) => el.child(right));
}

function card(t, children) {
  return v_flex().w_full().min_w(0).p(9).gap(7).rounded(6)
    .border(1).border_color(t.border).bg(t.surface).children(children);
}

function badge(t, text, color) {
  return div().flex_none().px(4).h(14).rounded(3).bg(color + "1f").flex().items_center()
    .text_size(8.5).font_medium().text_color(color).child(text);
}

function notice(t, text, color) {
  return h_flex().w_full().gap(6).p(8).rounded(5).border(1).border_color(t.border).bg(t.raised)
    .child(div().size(6).rounded_full().flex_none().bg(color))
    .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.muted).child(text));
}

function node(t, title, sub, color) {
  return v_flex().absolute().w(94).p(7).gap(2).rounded(5)
    .border(1).border_color(t.border).bg(t.surface)
    .child(div().w_full().text_size(9).font_medium().truncate().text_color(t.dim).child(String(title).toUpperCase()))
    .child(div().w_full().text_size(10.5).font_semibold().truncate().text_color(color || t.foreground).child(sub));
}

// rtflow: dashes move 8px every .7s. herdr's loop swings there and back, so the
// period is doubled to keep one leg at .7s.
function wire(t, live) {
  return div().absolute().left(8).right(8).top(62).h(8).overflow_hidden()
    .child(
      svg(WIRE).absolute().top(0).w(800).h(8).text_color(live ? t.accent : t.border)
        .when(live, (el) => el.loop("left", { from: 0, to: 8, period: 1400, easing: "linear" })),
    );
}

function stage(t, latest, live) {
  const acct = latest?.order?.[0];
  return div().id("rt-stage").relative().w_full().h(128).flex_none().overflow_hidden()
    .rounded(5).border(1).border_color(t.border).bg(t.raised)
    .child(wire(t, live))
    .child(node(t, "Agents", latest?.agent || "—", t.muted).left(8).top(30))
    .child(node(t, "magpie", "gateway", t.accent).left(110).top(30))
    .child(node(t, acct?.name || acct?.id || "Account", acct?.model || "—", t.foreground).left(212).top(30))
    .when(live, (el) => el.child(
      // rtlive: a 6px dot growing to 18px while fading out over 1.8s.
      div().absolute().left(300).top(57).w(6).h(6).rounded_full().bg(t.accent)
        .loop("width", { from: 6, to: 18, period: 1800 })
        .loop("height", { from: 6, to: 18, period: 1800 })
        .loop("opacity", { from: 1, to: 0, period: 1800 }),
    ))
    .when(live, (el) => el.child(
      // shortcut: the whole bird squashes where magpie flips only the wing
      // (rtflap scaleY(-.62)); the out-and-back left loop is request + answer.
      svg(BIRD).absolute().w(32).h(24).text_color(t.accent)
        .loop("left", { from: 105, to: 250, period: 2600, easing: "linear" })
        .loop("top", { from: 58, to: 50, period: 2600, easing: "ease-in-out" })
        .loop("height", { from: 24, to: 16, period: 420 }),
    ));
}

function row(t, d, i) {
  const ok = d.status >= 200 && d.status < 300;
  const color = ok ? t.done : t.blocked;
  const tries = Array.isArray(d.tries) ? d.tries.length : 0;
  const main = h_flex().w_full().items_center().gap(6)
    .child(div().w(56).flex_none().text_size(10).text_color(t.dim).child((d.time || "").slice(11, 19)))
    .child(div().w(44).flex_none().text_size(10).text_color(t.muted).truncate().child(d.agent || "—"))
    .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.foreground)
      .child(`${d.model || "?"} → ${d.served || d.provider || "?"}`))
    .child(div().size(5).rounded_full().flex_none().bg(color))
    .child(div().text_size(10).text_color(color).child(String(d.status ?? "…")))
    .child(div().w(48).flex_none().text_size(9).text_color(t.muted).child(msLabel(d.ms)));
  const sub = h_flex().w_full().flex_wrap().gap(8).items_center().children([
    div().text_size(9).text_color(t.dim).child(`provider ${d.provider || "—"}`),
    div().text_size(9).text_color(t.dim).child(`ttft ${msLabel(d.ttft)}`),
    div().text_size(9).text_color(t.dim).child(`flow ${msLabel(d.flow)}`),
    div().text_size(9).text_color(t.dim).child(`${tries} ${tries === 1 ? "try" : "tries"}`),
  ]);
  return v_flex().id(`rt-row-${i}`).w_full().min_w(0).gap(3).p(6).rounded(5)
    .border(1).border_color(t.border).bg(t.raised).hover((style) => style.bg(t.hover))
    .tooltip(`${d.model || "?"} · ${d.effort || "—"} · ${d.served || "?"}`)
    .child(main).child(sub);
}

export default class MagpieRouting extends View {
  init(_props, cx) {
    this.rows = [];
    this.error = null;
    this.busy = false;
    this.reload(cx);
    // Timers fetch data only; every animation above runs natively.
    cx.timer.every(3000, (timerCx) => this.reload(timerCx));
  }

  reload(cx) {
    if (this.busy) return;
    this.busy = true;
    const path = `${home()}/.config/magpie/routing/${today()}.jsonl`;
    cx.spawn(async (spawnCx) => {
      let rows = [];
      let error = null;
      try {
        const r = await exec("tail", ["-n", "60", path]);
        if (r.code !== 0) error = r.stderr.trim() || "no routing log yet";
        else {
          for (const line of r.stdout.split("\n")) {
            if (!line.trim()) continue;
            try { rows.push(JSON.parse(line)); } catch { /* partial last line */ }
          }
        }
      } catch (e) {
        error = String(e && e.message ? e.message : e);
      }
      this.busy = false;
      this.rows = rows.reverse();
      this.error = error;
      spawnCx.notify();
    });
  }

  render(_cx) {
    const t = theme();
    const rows = this.rows;
    const latest = rows[0];
    // The jsonl records completed requests only, so a fresh one stands in for
    // magpie's in-flight trace and lights the stage for eight seconds.
    const liveAt = latest ? Date.parse(latest.time) : NaN;
    const live = Boolean(latest && Date.now() - liveAt < 8000);
    const acct = latest?.order?.[0];
    const failed = rows.filter((r) => r.status >= 400).length;
    const caption = latest
      ? `${latest.agent || "agent"} → magpie → ${acct?.name || acct?.id || "?"} · ${latest.served || latest.model || ""}`
      : this.error || "Waiting for a request through magpie…";

    const header = h_flex().h(30).w_full().flex_none().items_center().gap(8).px(10)
      .bg(t.background).border_b(1).border_color(t.border)
      .child(div().size(6).rounded_full().flex_none().bg(this.error ? t.blocked : live ? t.accent : t.dim))
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Routing"))
      .child(div().min_w(0).truncate().text_size(10.5).text_color(t.dim)
        .child(`${rows.length} requests · ${failed} failed`))
      .child(div().flex_1())
      .child(badge(t, live ? "LIVE" : "IDLE", live ? t.accent : t.dim)
        .when(live, (el) => el.loop("opacity", { from: 0.4, to: 1, period: 1800 })));

    const body = [
      card(t, [
        section(t, "Route", caption, badge(t, "gateway", t.dim)),
        stage(t, latest, live),
      ]),
      card(t, [
        section(t, "Requests", "newest first", badge(t, `${rows.length} logs`, t.dim)),
        ...(rows.length
          ? rows.map((d, i) => row(t, d, i))
          : [notice(t, this.error || "No requests through magpie yet.", t.dim)]),
      ]),
    ];

    return v_flex().id("magpie-routing-root").size_full().min_w(0).rounded(8).overflow_hidden()
      .bg(t.canvas).border_1().border_color(t.border).text_size(11.5)
      .child(header)
      .child(v_flex().flex_1().w_full().min_h(0).overflow_y_scrollbar().p(8).gap(8)
        .children(body));
  }
}
