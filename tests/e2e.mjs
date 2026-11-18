/**
 * e2e.mjs — interaction acceptance suite for the rebuilt Canvas 增强 plugin.
 *
 * Runs against an isolated Obsidian instance using real CDP input events, and
 * asserts on the live canvas model + computed styles. A green build is never
 * treated as acceptance: every case performs the action and observes the result.
 *
 * Usage:  node tests/e2e.mjs            # all cases
 *         node tests/e2e.mjs TC-01       # one case
 */

import { connect } from "./harness.mjs";

const only = process.argv[2];
const results = [];
const h = await connect();

// ---------------------------------------------------------------- in-page API

const PAGE_HELPERS = `
window.__jce = {
  canvas() {
    const v = app.workspace.activeLeaf?.view;
    return v && v.getViewType && v.getViewType() === "canvas" ? v.canvas : null;
  },
  nodes() {
    const c = this.canvas(); if (!c) return [];
    return [...c.nodes.values()].map(n => {
      const d = n.getData();
      return { id: n.id, kind: d.jce || null, text: d.text ?? d.label ?? null,
        x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.width), h: Math.round(n.height),
        color: n.color || "", root: d.jceRoot ?? null, folded: d.jceFold === true,
        editing: !!n.isEditing, el: n.nodeEl };
    });
  },
  edges() {
    const c = this.canvas(); if (!c) return [];
    return [...c.edges.values()].map(e => ({ id: e.id, from: e.from.node.id, to: e.to.node.id }));
  },
  mmNodes() { return this.nodes().filter(n => n.kind === "mindmap"); },
  worldRect(id) {
    const n = this.nodes().find(n => n.id === id); if (!n) return null;
    return { x: n.x, y: n.y, w: n.w, h: n.h };
  },
  rectOf(id) {
    const n = this.nodes().find(n => n.id === id); if (!n) return null;
    const r = n.el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2 };
  },
  toolHost() {
    const c = this.canvas();
    return (c && c.wrapperEl.closest('.view-content')) || document;
  },
  toolRect(tool) {
    const b = this.toolHost().querySelector('.jce-toolbar .jce-tool[data-tool="' + tool + '"]');
    if (!b) return null; const r = b.getBoundingClientRect();
    return { cx: r.x + r.width/2, cy: r.y + r.height/2 };
  },
  tools() {
    const bar = this.toolHost().querySelector('.jce-toolbar');
    return bar ? [...bar.querySelectorAll('.jce-tool')].map(b => b.dataset.tool) : [];
  },
  wrapperRect() {
    const c = this.canvas(); const r = c.wrapperEl.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  },
  blankPoint() {
    const r = this.wrapperRect();
    return { x: r.x + r.w * 0.72, y: r.y + r.h * 0.3 };
  },
  /* a point far away from existing nodes, for panning/blank clicks */
  farPoint() {
    const r = this.wrapperRect();
    return { x: r.x + r.w * 0.16, y: r.y + r.h * 0.86 };
  },
  worldCenter() {
    const c = this.canvas(); const b = c.getViewportBBox();
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  },
  viewport() { const c=this.canvas(); return {zoom:c.tZoom, tx:Math.round(c.tx), ty:Math.round(c.ty)}; },
  bar() { return app.plugins.plugins['canvas-enhance'].formats.el; },
  barRect() {
    const el = this.bar(); if (!el || el.hidden) return {visible:false};
    const r = el.getBoundingClientRect();
    return {visible:true, x:r.x, y:r.y, w:r.width, h:r.height,
      buttons: el.querySelectorAll('.jce-format-btn').length};
  },
  menuItems() {
    return [...document.querySelectorAll('.menu .menu-item')].map(i => ({
      title: (i.querySelector('.menu-item-title') || i).textContent.trim(),
      el: i,
    })).filter(x => x.title);
  },
  editingFrame() {
    const n = this.nodes().find(n => n.editing);
    return n ? n.el.querySelector('iframe') : null;
  },
  cmText() {
    const f = this.editingFrame(); if (!f) return null;
    const c = f.contentDocument && f.contentDocument.querySelector('.cm-content');
    return c ? c.textContent : null;
  },
  overlayStats() {
    const c = this.canvas();
    const svg = c.canvasEl.querySelector('svg.jce-overlay');
    return { paths: svg ? svg.querySelectorAll('path.jce-mm-path').length : 0,
      arrows: svg ? svg.querySelectorAll('polygon.jce-mm-arrow').length : 0,
      hiddenNative: [...c.edges.values()].filter(e => e.lineGroupEl?.classList.contains('jce-hide-native')).length,
      totalEdges: c.edges.size };
  },
};
true;
`;

await h.evaluate(PAGE_HELPERS);

const J = (expr) => h.evaluate(`(()=>{ ${PAGE_HELPERS} return (${expr}); })()`);
const jcall = (name, ...args) =>
  J(`window.__jce.${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ fixtures

let caseNo = 0;

/** A brand-new canvas file per case.
 *  The file must be opened in a NEW tab: re-opening a canvas file in a leaf that
 *  already shows a canvas does not reload the model, which made runs flaky. */
async function reset() {
  const name = `jce-${Date.now()}-${++caseNo}.canvas`;
  const size = await h.evaluate(`(async()=>{
    await app.vault.create(${JSON.stringify(name)}, JSON.stringify({nodes:[],edges:[]}));
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(name)});
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(f);
    await new Promise(r=>setTimeout(r,700));
    // Retire older canvas leaves only after the new one is live.
    for (const other of app.workspace.getLeavesOfType("canvas")) {
      if (other === leaf) continue;
      try { other.detach(); } catch(e) {}
    }
    await new Promise(r=>setTimeout(r,400));
    const c = leaf.view.canvas;
    if (!c) throw new Error("canvas view did not open");
    c.setViewport(0, 0, 1);
    c.deselectAll();
    c.requestFrame();
    await new Promise(r=>setTimeout(r,250));
    return c.nodes.size;
  })()`);
  if (size !== 0) throw new Error("fixture not empty: " + size);
}

async function pick(tool) {
  const r = await jcall("toolRect", tool);
  if (!r) throw new Error("toolbar button missing: " + tool);
  await h.click(r.cx, r.cy);
  await sleep(150);
}

async function clickAt(pt) {
  await h.click(pt.x, pt.y);
  await sleep(400);
}

/** Create a mindmap root (and optionally N children) in a fresh canvas. */
async function mmRoot(children = 0) {
  await pick("mindmap");
  const pt = await jcall("blankPoint");
  await clickAt(pt);
  await h.key("Escape");
  await sleep(200);
  const nodes = await jcall("mmNodes");
  const root = nodes.find((n) => n.root === n.id);
  if (!root) throw new Error("mindmap root missing");
  for (let i = 0; i < children; i++) await addChild(root.id, "c" + (i + 1));
  return root;
}

async function addChild(parentId, text) {
  const r = await jcall("rectOf", parentId);
  if (!r) throw new Error("parent not on screen: " + parentId);
  await h.click(r.cx, r.cy);
  await sleep(150);
  await h.key("Tab");
  await sleep(400);
  if (text) await h.typeText(text);
  await h.key("Escape");
  await sleep(250);
}

async function selectAll(startKey, count) {
  await h.send("Input.dispatchKeyEvent", { type: "keyDown", key: startKey, code: startKey, windowsVirtualKeyCode: startKey === "Home" ? 36 : 35 });
  await h.send("Input.dispatchKeyEvent", { type: "keyUp", key: startKey, code: startKey, windowsVirtualKeyCode: startKey === "Home" ? 36 : 35 });
  for (let i = 0; i < count; i++) {
    await h.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers: 8 });
    await h.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers: 8 });
  }
}

async function clickMenuItem(title) {
  const target = await J(
    `(()=>{ const it = window.__jce.menuItems().find(i => i.title.includes(${JSON.stringify(title)}));
       if(!it) return null; const r = it.el.getBoundingClientRect();
       return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`
  );
  if (!target) throw new Error("menu item not found: " + title);
  await h.click(target.x, target.y);
  await sleep(350);
}

async function record(id, title, requirement, fn) {
  if (only && !id.toLowerCase().includes(only.toLowerCase())) return;
  try {
    const detail = await fn();
    results.push({ id, title, requirement, status: detail?.ok === false ? "FAIL" : "PASS", detail: detail?.text ?? "" });
  } catch (err) {
    results.push({ id, title, requirement, status: "FAIL", detail: String(err?.message ?? err) });
  }
}

// --------------------------------------------------------------------- cases

await record("TC-09", "四类对象新建与默认内容", "NOTE-01/02, TEXT-01, 导图根, SEC-01", async () => {
  await reset();
  const found = {};
  let i = 0;
  for (const tool of ["note", "text", "mindmap", "section"]) {
    await pick(tool);
    const pt = await jcall("blankPoint");
    const before = (await jcall("nodes")).length;
    const wr = await jcall("wrapperRect");
    await clickAt({ x: wr.x + wr.w * (0.3 + i * 0.12), y: wr.y + wr.h * 0.35 });
    i++;
    const nodes = await jcall("nodes");
    if (nodes.length !== before + 1) throw new Error(`${tool}: expected +1 node, got ${nodes.length - before}`);
    found[tool] = nodes[nodes.length - 1];
    await h.key("Escape");
    await sleep(150);
  }
  const checks = [
    [found.note?.kind === "note", "note kind"],
    [String(found.note?.text).includes("Note Card"), "note default text"],
    [found.text?.kind === "text", "text kind"],
    [(found.text?.text ?? "x") === "", "text default empty"],
    [found.mindmap?.kind === "mindmap", "mindmap kind"],
    [found.mindmap?.text === "Mindmap", "mindmap root default"],
    [found.mindmap?.root === found.mindmap?.id, "mindmap root pointer"],
    [found.section?.kind === "section", "section kind"],
    [found.section?.text === "Section", "section default label"],
  ];
  const bad = checks.filter((c) => !c[0]).map((c) => c[1]);
  return { ok: bad.length === 0, text: bad.length ? "failed: " + bad.join(", ") : "4 objects ok; Text initial=\"\"" };
});

await record("TC-13", "工具栏顺序与输入不被打断", "TOOL-01 / §8 文案", async () => {
  await reset();
  const tools = await jcall("tools");
  const expected = ["select", "connect", "note", "text", "mindmap", "section"];
  const orderOk = JSON.stringify(tools) === JSON.stringify(expected);
  const titles = await h.evaluate(`[...window.__jce.toolHost().querySelectorAll('.jce-toolbar .jce-tool')]
    .map(b => b.getAttribute('aria-label'))`);
  const copyOk =
    titles[0] === "选择 / Select  V" &&
    titles[1] === "连线 / Connect  C" &&
    titles[2] === "笔记卡 / Note card  N" &&
    titles[3] === "文字 / Text  T" &&
    titles[4] === "思维导图 / Mindmap  M" &&
    titles[5] === "分区 / Section  G";

  // Typing the tool letters inside a card must not create objects (TOOL-01).
  await pick("text");
  const pt = await jcall("blankPoint");
  await clickAt(pt);
  const before = (await jcall("nodes")).length;
  await h.typeText("nmtvcg");
  await sleep(300);
  const after = (await jcall("nodes")).length;
  const typed = await jcall("cmText");

  const ok = orderOk && copyOk && before === after && typed === "nmtvcg";
  return {
    ok,
    text: `tools=${tools.join(",")}; copy=${copyOk}; typed text kept=${JSON.stringify(typed)}; node count ${before}→${after}`,
  };
});

await record("TC-01", "同父连续三个孩子（Tab）", "MM-03/04/05/06/07", async () => {
  await reset();
  const root = await mmRoot(0);

  const snapshots = [];
  for (let i = 0; i < 3; i++) {
    const kids = (await jcall("mmNodes")).filter((n) => n.id !== root.id);
    snapshots.push(await Promise.all(kids.map(async (n) => ({ id: n.id, r: await jcall("worldRect", n.id) }))));
    await addChild(root.id, "child" + (i + 1));
  }

  const nodes = await jcall("nodes");
  const kids = nodes.filter((n) => n.kind === "mindmap" && n.id !== root.id);
  const edges = await jcall("edges");
  const arrows = kids.filter((k) => edges.some((e) => e.from === root.id && e.to === k.id));

  const drift = [];
  for (const snap of snapshots) {
    for (const item of snap) {
      const now = await jcall("worldRect", item.id);
      if (!now) { drift.push(`${item.id.slice(0, 5)} vanished`); continue; }
      if (Math.abs(now.x - item.r.x) > 1 || Math.abs(now.y - item.r.y) > 1) drift.push(`${item.id.slice(0, 5)} moved`);
    }
  }

  // each child must be a real, editable node with the text we typed
  const texts = kids.map((k) => String(k.text ?? "").trim());
  const textOk = ["child1", "child2", "child3"].every((t) => texts.includes(t));

  const ok = kids.length === 3 && arrows.length === 3 && drift.length === 0 && textOk;
  return {
    ok,
    text: `children=${kids.length}, parent→child arrows=${arrows.length}, texts=${JSON.stringify(texts)}, old siblings moved=${drift.length ? drift.join(";") : "none"}`,
  };
});

await record("TC-02", "尺寸继承", "MM-04", async () => {
  await reset();
  const root = await mmRoot(0);
  // Give the root a distinctive size so "everyone used the default" would fail.
  await h.evaluate(`(()=>{
    const c=app.workspace.activeLeaf.view.canvas;
    const n=[...c.nodes.values()].find(n=>n.getData().jceRoot===n.id);
    n.moveAndResize({x:n.x,y:n.y,width:260,height:96});
    c.requestSave(); c.requestFrame(); return true;
  })()`);
  await sleep(350);
  const childIds = async () => (await jcall("edges")).filter((e) => e.from === root.id).map((e) => e.to);
  await addChild(root.id, "first");
  const ids1 = await childIds();
  await addChild(root.id, "second");
  const ids2 = await childIds();
  const mm = await jcall("mmNodes");
  const rootNow = mm.find((n) => n.id === root.id);
  const first = mm.find((n) => n.id === ids1[0]);
  const second = mm.find((n) => n.id === ids2.find((id) => id !== ids1[0]));
  const ok =
    !!first && !!second &&
    first.w === rootNow.w && first.h === rootNow.h &&
    second.w === first.w && second.h === first.h;
  return {
    ok,
    text: `root ${rootNow.w}x${rootNow.h}; first ${first?.w}x${first?.h} (inherit root); second ${second?.w}x${second?.h} (inherit first sibling)`,
  };
});

await record("TC-03", "嵌套子树拖动", "MM-09", async () => {
  await reset();
  const root = await mmRoot(1);
  const parent = (await jcall("mmNodes")).find((n) => n.id !== root.id);
  await addChild(parent.id, "A1");

  const edges = await jcall("edges");
  const descendantsOf = (id) => {
    const out = [];
    const walk = (cur) => { for (const e of edges) if (e.from === cur) { out.push(e.to); walk(e.to); } };
    walk(id);
    return out;
  };
  const desc = new Set(descendantsOf(parent.id));
  if (!desc.size) throw new Error("no descendants to follow");

  const all = await jcall("mmNodes");
  const before = {};
  for (const n of all) before[n.id] = await jcall("rectOf", n.id);

  const pr = before[parent.id];
  const zoom = await h.evaluate(`app.workspace.activeLeaf.view.canvas.tZoom`);
  await h.drag(pr.cx, pr.cy, pr.cx + 130, pr.cy + 55, 14);
  await sleep(550);

  const moved = {};
  for (const n of all) {
    const now = await jcall("rectOf", n.id);
    moved[n.id] = { dx: now.x - before[n.id].x, dy: now.y - before[n.id].y };
  }
  const self = moved[parent.id];
  const descMoved = [...desc].map((id) => moved[id]);
  const unrelated = all.filter((n) => n.id !== parent.id && !desc.has(n.id));
  const othersStill = unrelated.every((n) => Math.hypot(moved[n.id].dx, moved[n.id].dy) < 3);
  const ownOk = Math.hypot(self.dx, self.dy) > 60;
  const descOk = descMoved.every((m) => Math.hypot(m.dx, m.dy) > 60);
  const sameDelta = descMoved.every((m) => Math.abs(m.dx - self.dx) < 4 && Math.abs(m.dy - self.dy) < 4);

  const ok = ownOk && descOk && sameDelta && othersStill;
  return {
    ok,
    text: `zoom=${zoom}; parent moved (${Math.round(self.dx)},${Math.round(self.dy)}); descendants [${descMoved
      .map((m) => `${Math.round(m.dx)},${Math.round(m.dy)}`)
      .join(" / ")}]; unrelated stayed=${othersStill}`,
  };
});

await record("TC-04", "导图节点透明（含编辑态）", "MM-01/02", async () => {
  await reset();
  const root = await mmRoot(1);
  const child = (await jcall("mmNodes")).find((n) => n.id !== root.id);

  const idle = await h.evaluate(`(()=>{
    const el=document.querySelector('.canvas-node.jce-mindmap .canvas-node-container');
    if(!el) return null; const cs=getComputedStyle(el);
    return {bg:cs.backgroundColor, border:cs.borderTopColor};
  })()`);

  const r = await jcall("rectOf", child.id);
  await h.mouse("mouseMoved", r.cx, r.cy, { buttons: 0 });
  await h.mouse("mousePressed", r.cx, r.cy, { clickCount: 1 });
  await h.mouse("mouseReleased", r.cx, r.cy, { clickCount: 1, buttons: 0 });
  await sleep(80);
  await h.mouse("mousePressed", r.cx, r.cy, { clickCount: 2 });
  await h.mouse("mouseReleased", r.cx, r.cy, { clickCount: 2, buttons: 0 });
  await sleep(650);

  const editing = await h.evaluate(`(()=>{
    const wrap=document.querySelector('.canvas-node.jce-mindmap.is-editing');
    if(!wrap) return {editing:false};
    const ifr=wrap.querySelector('iframe'); const doc=ifr&&ifr.contentDocument;
    const cont=wrap.querySelector('.canvas-node-container');
    const inner=doc&&doc.querySelector('.cm-content');
    return {editing:true,
      containerBg:cont?getComputedStyle(cont).backgroundColor:null,
      bodyBg:doc?getComputedStyle(doc.body).backgroundColor:null,
      cmBg:inner?getComputedStyle(inner).backgroundColor:null};
  })()`);

  const t = (v) => v === "rgba(0, 0, 0, 0)" || v === "transparent";
  const ok = t(idle?.bg) && editing.editing && t(editing.containerBg) && t(editing.bodyBg) && t(editing.cmBg);
  return {
    ok,
    text: `idle container=${idle?.bg}; editing=${editing.editing} container=${editing.containerBg}, iframe body=${editing.bodyBg}, cm-content=${editing.cmBg}`,
  };
});

await record("TC-05", "层级线与原生 chrome", "MM-06/07/08", async () => {
  await reset();
  await mmRoot(3);
  await h.key("Escape");
  await sleep(200);
  const stats = await jcall("overlayStats");
  const chrome = await h.evaluate(`(()=>{
    const c=app.workspace.activeLeaf.view.canvas;
    const node=[...c.nodes.values()].find(n=>n.getData().jce==='mindmap');
    const r=node.nodeEl.getBoundingClientRect();
    node.select && node.select();
    return {menuDisplay:getComputedStyle(document.querySelector('.canvas-menu-container')||document.body).display,
      menuExists:!!document.querySelector('.canvas-menu-container'),
      resizers:[...document.querySelectorAll('.canvas-node.jce-mindmap .canvas-node-resizer')].filter(e=>getComputedStyle(e).display!=='none').length};
  })()`);
  await sleep(300);
  const menuAfterSelect = await h.evaluate(`(()=>{
    const el=document.querySelector('.canvas-menu-container');
    return el?getComputedStyle(el).display:'(absent)';
  })()`);

  const ok =
    stats.paths === 3 && stats.arrows === 3 &&
    stats.hiddenNative === stats.totalEdges &&
    chrome.resizers === 0 &&
    (menuAfterSelect === "none" || menuAfterSelect === "(absent)");
  return { ok, text: `paths=${stats.paths} arrows=${stats.arrows} nativeHidden=${stats.hiddenNative}/${stats.totalEdges}; resizers visible=${chrome.resizers}; native menu on select=${menuAfterSelect}` };
});

await record("TC-06", "格式条随选区出现并跟随", "FMT-01/02/03/04", async () => {
  await reset();
  await pick("text");
  const pt = await jcall("blankPoint");
  await clickAt(pt);
  await h.typeText("hello world");
  await sleep(350);
  if ((await jcall("cmText")) !== "hello world") throw new Error("typing into the card failed");

  await selectAll("Home", 5);
  await sleep(450);

  const bar1 = await jcall("barRect");
  const sel = await h.evaluate(`(()=>{
    const f=document.querySelector('.canvas-node iframe'); const d=f&&f.contentDocument;
    const s=d&&d.getSelection(); if(!s||!s.rangeCount) return null;
    const r=s.getRangeAt(0).getBoundingClientRect(); const b=f.getBoundingClientRect();
    const sx=b.width/(f.contentWindow.innerWidth||b.width);
    return {x:b.x+r.x*sx, y:b.y+r.y*sx, text:s.toString()};
  })()`);
  const aboveOk = bar1.visible && sel ? bar1.y + bar1.h <= sel.y + 6 : false;

  // FMT-03: pan the canvas from a blank spot; the bar must travel with the text.
  const before = { x: bar1.x, y: bar1.y };
  const far = await jcall("farPoint");
  const vp0 = await jcall("viewport");
  await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: far.x, y: far.y, deltaX: 0, deltaY: 300, button: "none", buttons: 0 });
  await sleep(400);
  const vp1 = await jcall("viewport");
  const bar2 = await jcall("barRect");
  const traveled = Math.hypot(bar2.x - before.x, bar2.y - before.y);
  const panned = Math.abs(vp1.ty - vp0.ty) > 10 || Math.abs(vp1.tx - vp0.tx) > 10;
  const followed = bar2.visible && traveled > 5;

  // FMT-04: bold really changes the text.
  let bold = null;
  if (bar2.visible) {
    const b = await h.evaluate(`(()=>{const el=app.plugins.plugins['canvas-enhance'].formats.el.querySelector('.jce-format-btn[data-fmt="bold"]');const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await h.click(b.x, b.y);
    await sleep(400);
    bold = await jcall("cmText");
  }

  const ok = bar1.visible && bar1.buttons === 10 && aboveOk && panned && followed && bold === "**hello** world";
  return {
    ok,
    text: `visible=${bar1.visible} buttons=${bar1.buttons} aboveSelection=${aboveOk}; pan ${JSON.stringify(vp0)}→${JSON.stringify(vp1)}; bar travelled ${Math.round(traveled)}px (followed=${followed}); bold=${JSON.stringify(bold)}`,
  };
});

await record("TC-07", "关菜单不拖动", "MENU-01/02", async () => {
  await reset();
  const pt = await jcall("farPoint");
  const before = await jcall("worldCenter");
  await h.clickRight(pt.x, pt.y);
  await sleep(400);
  const items = await J(`window.__jce.menuItems().map(i=>i.title)`);
  const opened = Array.isArray(items) && items.length >= 4;
  const blank = await jcall("blankPoint");
  await h.click(blank.x, blank.y);
  await sleep(400);
  const stillOpen = await h.evaluate(`document.querySelectorAll('.menu').length`);
  const after = await jcall("worldCenter");
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  const ok = opened && stillOpen === 0 && moved < 2;
  return { ok, text: `opened=${opened} items=${JSON.stringify(items)}; closed=${stillOpen === 0}; canvas moved ${moved.toFixed(1)}px` };
});

await record("TC-08", "连线工具真实建连", "CON-01/02", async () => {
  await reset();
  await pick("note");
  let pt = await jcall("blankPoint");
  await clickAt({ x: pt.x - 220, y: pt.y });
  await h.key("Escape");
  await pick("text");
  await clickAt({ x: pt.x + 140, y: pt.y + 190 });
  await h.key("Escape");
  await sleep(200);

  const nodes = await jcall("nodes");
  if (nodes.length !== 2) throw new Error("expected 2 objects, got " + nodes.length);
  const [a, b] = nodes;
  const ra = await jcall("rectOf", a.id);
  const rb = await jcall("rectOf", b.id);

  await pick("connect");
  await h.click(ra.cx, ra.cy);
  await sleep(200);
  await h.click(rb.cx, rb.cy);
  await sleep(450);

  const edges = await jcall("edges");
  const made = edges.find((e) => e.from === a.id && e.to === b.id);
  const data = await h.evaluate(`(()=>{
    const c=app.workspace.activeLeaf.view.canvas;
    const e=[...c.edges.values()].find(e=>e.from.node.id==='${a.id}'&&e.to.node.id==='${b.id}');
    return e?e.getData():null;
  })()`);
  const arrowOk = !data?.toEnd || data.toEnd === "arrow"; // getData omits the default
  const ok = !!made && arrowOk && data?.fromNode === a.id && data?.toNode === b.id;
  return { ok, text: `edges=${edges.length}; from→to ok=${data?.fromNode === a.id && data?.toNode === b.id}; arrow end=${data?.toEnd ?? "(default)"}` };
});

await record("TC-10", "分区默认灰与画布底区分", "SEC-02 / BASE-05", async () => {
  await reset();
  await pick("section");
  const pt = await jcall("blankPoint");
  await clickAt(pt);
  const styles = await h.evaluate(`(()=>{
    const node=document.querySelector('.canvas-node.jce-section');
    const container=node&&node.querySelector('.canvas-node-container');
    const label=node&&node.querySelector('.canvas-group-label');
    return {container:container?getComputedStyle(container).backgroundColor:null,
      label:label?getComputedStyle(label).backgroundColor:null};
  })()`);
  const want = "rgb(216, 216, 216)";
  const ok = styles.container === want && styles.label === want;
  return { ok, text: `container=${styles.container}, label=${styles.label} (want ${want})` };
});

await record("TC-12", "对象菜单与折叠", "MENU-03/04, MM-10", async () => {
  await reset();
  await pick("note");
  const pt = await jcall("blankPoint");
  await clickAt(pt);
  await h.key("Escape");
  await sleep(200);

  const note = (await jcall("nodes"))[0];
  const nr = await jcall("rectOf", note.id);
  await h.clickRight(nr.cx, nr.cy);
  await sleep(400);
  const noteItems = await J(`window.__jce.menuItems().map(i=>i.title)`);
  const hasColor = noteItems.some((t) => t.includes("颜色") && t.includes("Color"));
  const hasRemove = noteItems.some((t) => t.includes("移除") && t.includes("Remove"));
  await clickMenuItem("移除");
  const afterRemove = (await jcall("nodes")).length;

  // Mindmap: Fold must hide the subtree and Unfold restore it.
  const root = await mmRoot(2);
  const rr = await jcall("rectOf", root.id);
  await h.clickRight(rr.cx, rr.cy);
  await sleep(400);
  const mmItems = await J(`window.__jce.menuItems().map(i=>i.title)`);
  const hasFold = mmItems.some((t) => t.includes("折叠") && t.includes("Fold"));
  const hasRotate = mmItems.some((t) => t.includes("旋转") && t.includes("Rotate"));

  const pathsBefore = (await jcall("overlayStats")).paths;
  await clickMenuItem("折叠");
  await sleep(400);
  const afterFold = await h.evaluate(`(()=>({
    hidden: document.querySelectorAll('.canvas-node.jce-mm-hidden').length,
    paths: document.querySelectorAll('svg.jce-overlay path.jce-mm-path').length }))()`);

  await h.clickRight(rr.cx, rr.cy);
  await sleep(400);
  const unfoldItems = await J(`window.__jce.menuItems().map(i=>i.title)`);
  const showsUnfold = unfoldItems.some((t) => t.includes("展开") && t.includes("Unfold"));
  await clickMenuItem("展开");
  await sleep(400);
  const afterUnfold = await h.evaluate(`document.querySelectorAll('.canvas-node.jce-mm-hidden').length`);

  const ok =
    hasColor && hasRemove && afterRemove === 0 &&
    hasFold && hasRotate && afterFold.hidden === 2 && afterFold.paths === 0 &&
    showsUnfold && afterUnfold === 0;
  return {
    ok,
    text: `note menu=[${noteItems.join("|")}] remove→${afterRemove} nodes; mindmap menu has Fold=${hasFold} Rotate=${hasRotate}; fold hid ${afterFold.hidden} nodes / ${pathsBefore}→${afterFold.paths} lines; Unfold item=${showsUnfold} restored=${afterUnfold === 0}`,
  };
});

await record("RG-01", "保存重开后结构保留", "RG-01", async () => {
  await reset();
  const root = await mmRoot(1);
  const beforeNodes = await jcall("nodes");
  const beforeEdges = await jcall("edges");
  const path = await h.evaluate(`app.workspace.activeLeaf.view.file.path`);

  await h.evaluate(`(async()=>{
    const v=app.workspace.activeLeaf.view;
    v.canvas.requestSave();
    await new Promise(r=>setTimeout(r,700));
    return true;
  })()`);
  // Re-open from disk in a different leaf so the reload is real.
  await h.evaluate(`(async()=>{
    const f=app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    const leaf=app.workspace.getLeaf('split');
    await leaf.openFile(f);
    await new Promise(r=>setTimeout(r,900));
    return true;
  })()`);
  await sleep(400);

  const afterNodes = await jcall("nodes");
  const afterEdges = await jcall("edges");
  const kindsKept = afterNodes.every((n) => n.kind === beforeNodes.find((b) => b.id === n.id)?.kind);
  const textsKept = afterNodes.every((n) => {
    const before = beforeNodes.find((b) => b.id === n.id);
    return before ? String(before.text ?? "") === String(n.text ?? "") : false;
  });
  const overlay = await jcall("overlayStats");
  const ok =
    afterNodes.length === beforeNodes.length &&
    afterEdges.length === beforeEdges.length &&
    kindsKept && textsKept && overlay.paths === 1;
  return {
    ok,
    text: `nodes ${beforeNodes.length}→${afterNodes.length}, edges ${beforeEdges.length}→${afterEdges.length}, kinds kept=${kindsKept}, texts kept=${textsKept}, redrawn lines=${overlay.paths}`,
  };
});

// -------------------------------------------------------------------- report

await h.shot(".recon/e2e-final.png");
h.close();

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log("\n=== Canvas 增强 · 交互自测结果 ===\n");
console.log(pad("ID", 8) + pad("状态", 6) + pad("需求", 26) + "说明");
console.log("-".repeat(140));
for (const r of results) {
  console.log(pad(r.id, 8) + pad(r.status, 6) + pad(r.requirement, 26) + `${r.title} — ${r.detail}`);
}
const passed = results.filter((r) => r.status === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
if (h.consoleErrors.length) {
  console.log("\nconsole errors:");
  for (const e of [...new Set(h.consoleErrors)].slice(0, 8)) console.log(" -", e.split("\n")[0]);
}
process.exitCode = passed === results.length ? 0 : 1;
