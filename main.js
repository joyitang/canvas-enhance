"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  TOOLS: () => TOOLS,
  default: () => CanvasEnhancePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/bridge.ts
var edgeCtors = /* @__PURE__ */ new WeakMap();
function uid() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function allNodes(canvas) {
  return Array.from(canvas.nodes.values());
}
function isEditing(node) {
  if (node.isEditing) return true;
  return !!node.nodeEl?.classList.contains("is-editing");
}
function viewportCenter(canvas, size) {
  const box = canvas.getViewportBBox();
  return {
    x: Math.round((box.minX + box.maxX) / 2 - size.width / 2),
    y: Math.round((box.minY + box.maxY) / 2 - size.height / 2)
  };
}
function nodeFromEvent(canvas, evt) {
  const target = evt instanceof Element ? evt : evt.target;
  if (!target) return null;
  const el = target.closest?.(".canvas-node");
  const scopeEl = el instanceof HTMLElement ? el : target instanceof HTMLElement ? target : null;
  if (!scopeEl) return null;
  for (const node of canvas.nodes.values()) {
    const nel = node.nodeEl;
    if (!nel) continue;
    if (nel === scopeEl || nel.contains(scopeEl) || scopeEl.contains(nel)) return node;
  }
  return null;
}
function isInsideCanvasUi(el) {
  if (!el) return false;
  return !!el.closest(
    ".jce-toolbar, .jce-format-bar, .jce-menu, .menu, .modal-container, .canvas-controls, .canvas-card-menu, .canvas-menu"
  );
}
function commit(canvas) {
  canvas.requestSave();
  canvas.requestFrame();
}
function edgeCtor(canvas) {
  const cached = edgeCtors.get(canvas);
  if (cached) return cached;
  const first = canvas.edges.values().next();
  if (first.done) return void 0;
  const ctor = first.value.constructor;
  edgeCtors.set(canvas, ctor);
  return ctor;
}
function findEdge(canvas, fromId, toId) {
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id === fromId && edge.to.node.id === toId) return edge;
  }
  return void 0;
}
function createEdge(canvas, from, to, sides) {
  const existing = findEdge(canvas, from.id, to.id);
  if (existing) return existing;
  const ctor = edgeCtor(canvas);
  if (ctor) {
    const edge = new ctor(
      canvas,
      uid(),
      { node: from, side: sides.from, end: "none" },
      { node: to, side: sides.to, end: "arrow" }
    );
    canvas.addEdge(edge);
    edge.render?.();
    commit(canvas);
    return edge;
  }
  const data = structuredClone(canvas.getData());
  const id = uid();
  data.edges.push({
    id,
    fromNode: from.id,
    fromSide: sides.from,
    fromEnd: "none",
    toNode: to.id,
    toSide: sides.to,
    toEnd: "arrow"
  });
  canvas.setData(data);
  const made = canvas.edges.get(id);
  if (made) edgeCtors.set(canvas, made.constructor);
  canvas.requestFrame();
  return made;
}
function deleteNodes(canvas, ids) {
  const kill = new Set(ids);
  for (const node of Array.from(canvas.nodes.values())) {
    if (kill.has(node.id)) canvas.removeNode(node);
  }
  for (const edge of Array.from(canvas.edges.values())) {
    if (kill.has(edge.from.node.id) || kill.has(edge.to.node.id)) canvas.removeEdge(edge);
  }
  canvas.requestSave();
  canvas.requestFrame();
}
function selectedNodes(canvas) {
  return Array.from(canvas.selection ?? []);
}
function autoSides(a, b) {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  }
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

// src/model.ts
var TAG = "jce";
var ROOT = "jceRoot";
var LAYOUT = "jceLayout";
var FOLD = "jceFold";
var LAYOUT_ORDER = ["TB", "LR", "BT", "RL"];
function dataOf(node) {
  return node.getData();
}
function kindOf(node) {
  const kind = dataOf(node)[TAG];
  return kind === "note" || kind === "text" || kind === "mindmap" || kind === "section" ? kind : void 0;
}
function isMindmap(node) {
  return kindOf(node) === "mindmap";
}
function rootIdOf(node) {
  const id = dataOf(node)[ROOT];
  return typeof id === "string" ? id : void 0;
}
function layoutOf(canvas, rootId) {
  const root = canvas.nodes.get(rootId);
  const raw = root ? dataOf(root)[LAYOUT] : void 0;
  return raw === "TB" || raw === "LR" || raw === "BT" || raw === "RL" ? raw : "TB";
}
function nextLayout(layout) {
  const i = LAYOUT_ORDER.indexOf(layout);
  return LAYOUT_ORDER[(i + 1) % LAYOUT_ORDER.length];
}
function treeOf(canvas, rootId) {
  const members = /* @__PURE__ */ new Set();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node) && rootIdOf(node) === rootId) members.add(node.id);
  }
  members.add(rootId);
  const children = /* @__PURE__ */ new Map();
  const parent = /* @__PURE__ */ new Map();
  for (const id of members) children.set(id, []);
  for (const edge of canvas.edges.values()) {
    const from = edge.from.node.id;
    const to = edge.to.node.id;
    if (!members.has(from) || !members.has(to)) continue;
    if (parent.has(to)) continue;
    parent.set(to, from);
    children.get(from).push(to);
  }
  for (const [child, par] of parent) {
    if (!members.has(par)) parent.delete(child);
  }
  return { rootId, layout: layoutOf(canvas, rootId), children, parent };
}
function rootIds(canvas) {
  const out = [];
  for (const node of canvas.nodes.values()) {
    if (!isMindmap(node)) continue;
    const root = rootIdOf(node);
    if (root === node.id) out.push(node.id);
  }
  return out;
}
function descendantsOf(tree, id) {
  const out = [];
  const walk = (current) => {
    for (const child of tree.children.get(current) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}
function hiddenByFold(canvas) {
  const hidden = /* @__PURE__ */ new Set();
  for (const root of rootIds(canvas)) {
    const tree = treeOf(canvas, root);
    for (const [id, kids] of tree.children) {
      if (!kids.length) continue;
      const node = canvas.nodes.get(id);
      if (!node || dataOf(node)[FOLD] !== true) continue;
      for (const d of descendantsOf(tree, id)) hidden.add(d);
    }
  }
  return hidden;
}
function isFolded(canvas, id) {
  const node = canvas.nodes.get(id);
  return !!node && dataOf(node)[FOLD] === true;
}
function hasChildren(canvas, id) {
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id === id && isMindmap(edge.to.node)) return true;
  }
  return false;
}
function childrenOf(canvas, id) {
  const out = [];
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id !== id) continue;
    const child = canvas.nodes.get(edge.to.node.id);
    if (child && isMindmap(child)) out.push(child);
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y);
  return out;
}
function mindmapEdges(canvas) {
  const out = [];
  for (const edge of canvas.edges.values()) {
    if (isMindmap(edge.from.node) && isMindmap(edge.to.node)) out.push(edge);
  }
  return out;
}
function mindmapNodeIds(canvas) {
  const ids = /* @__PURE__ */ new Set();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node)) ids.add(node.id);
  }
  return ids;
}

// src/layout.ts
var CHILD_GAP = 56;
var SIB_GAP = 36;
var STEM = 20;
var CORNER = 8;
var ARROW = 7;
var ARROW_HALF = 3.6;
var MM_SIZE = { width: 180, height: 48 };
var KIND_SIZE = {
  note: { width: 280, height: 200 },
  text: { width: 240, height: 72 },
  mindmap: MM_SIZE,
  section: { width: 560, height: 360 }
};
function right(r) {
  return r.x + r.width;
}
function bottom(r) {
  return r.y + r.height;
}
function centerX(r) {
  return r.x + r.width / 2;
}
function centerY(r) {
  return r.y + r.height / 2;
}
function inheritedSize(parent, siblings) {
  const source = siblings.length ? siblings[siblings.length - 1] : parent;
  return {
    width: Math.max(1, Math.round(source.width)),
    height: Math.max(1, Math.round(source.height))
  };
}
function childPosition(parent, siblings, size, layout) {
  const last = siblings[siblings.length - 1];
  switch (layout) {
    case "TB": {
      if (!last) {
        return {
          x: Math.round(centerX(parent) - size.width / 2),
          y: Math.round(bottom(parent) + CHILD_GAP)
        };
      }
      const far = Math.max(...siblings.map(right));
      return { x: Math.round(far + SIB_GAP), y: Math.round(last.y) };
    }
    case "BT": {
      if (!last) {
        return {
          x: Math.round(centerX(parent) - size.width / 2),
          y: Math.round(parent.y - CHILD_GAP - size.height)
        };
      }
      const far = Math.max(...siblings.map(right));
      return { x: Math.round(far + SIB_GAP), y: Math.round(last.y) };
    }
    case "LR": {
      if (!last) {
        return {
          x: Math.round(right(parent) + CHILD_GAP),
          y: Math.round(centerY(parent) - size.height / 2)
        };
      }
      const far = Math.max(...siblings.map(bottom));
      return { x: Math.round(last.x), y: Math.round(far + SIB_GAP) };
    }
    case "RL": {
      if (!last) {
        return {
          x: Math.round(parent.x - CHILD_GAP - size.width),
          y: Math.round(centerY(parent) - size.height / 2)
        };
      }
      const far = Math.max(...siblings.map(bottom));
      return { x: Math.round(last.x), y: Math.round(far + SIB_GAP) };
    }
  }
}
var vertical = (layout) => layout === "TB" || layout === "BT";
var forward = (layout) => layout === "TB" || layout === "LR";
function connector(parent, child, layout) {
  const vert = vertical(layout);
  const sign = forward(layout) ? 1 : -1;
  const stem = STEM;
  const start = vert ? { x: centerX(parent), y: sign > 0 ? bottom(parent) : parent.y } : { x: sign > 0 ? right(parent) : parent.x, y: centerY(parent) };
  const end = vert ? { x: centerX(child), y: sign > 0 ? child.y : bottom(child) } : { x: sign > 0 ? child.x : right(child), y: centerY(child) };
  const span = vert ? (end.y - start.y) * sign : (end.x - start.x) * sign;
  const offset = vert ? end.x - start.x : end.y - start.y;
  const dir = Math.sign(offset) || 1;
  const tip = end;
  const stop = vert ? { x: end.x, y: end.y - sign * ARROW } : { x: end.x - sign * ARROW, y: end.y };
  let d;
  if (Math.abs(offset) < 0.5) {
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else if (span < stem + CORNER + 2) {
    const bend = Math.max(4, span * 0.5) * sign;
    d = vert ? `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(start.x)} ${fmt(start.y + bend)} ${fmt(stop.x)} ${fmt(stop.y - bend)} ${fmt(stop.x)} ${fmt(stop.y)}` : `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(start.x + bend)} ${fmt(start.y)} ${fmt(stop.x - bend)} ${fmt(stop.y)} ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else if (vert) {
    const bx = start.x;
    const by = start.y + sign * stem;
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(bx)} ${fmt(by - sign * CORNER)} Q ${fmt(bx)} ${fmt(by)} ${fmt(bx + dir * CORNER)} ${fmt(by)} L ${fmt(stop.x - dir * CORNER)} ${fmt(by)} Q ${fmt(stop.x)} ${fmt(by)} ${fmt(stop.x)} ${fmt(by + sign * CORNER)} L ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else {
    const bx = start.x + sign * stem;
    const by = start.y;
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(bx - sign * CORNER)} ${fmt(by)} Q ${fmt(bx)} ${fmt(by)} ${fmt(bx)} ${fmt(by + dir * CORNER)} L ${fmt(bx)} ${fmt(stop.y - dir * CORNER)} Q ${fmt(bx)} ${fmt(stop.y)} ${fmt(bx + sign * CORNER)} ${fmt(stop.y)} L ${fmt(stop.x)} ${fmt(stop.y)}`;
  }
  const arrow = vert ? `${fmt(tip.x)},${fmt(tip.y)} ${fmt(tip.x - ARROW_HALF)},${fmt(tip.y - sign * ARROW)} ${fmt(
    tip.x + ARROW_HALF
  )},${fmt(tip.y - sign * ARROW)}` : `${fmt(tip.x)},${fmt(tip.y)} ${fmt(tip.x - sign * ARROW)},${fmt(tip.y - ARROW_HALF)} ${fmt(
    tip.x - sign * ARROW
  )},${fmt(tip.y + ARROW_HALF)}`;
  return { d, arrow };
}
function fmt(n) {
  return (Math.round(n * 10) / 10).toString();
}

// src/overlay.ts
var NS = "http://www.w3.org/2000/svg";
var OVERLAY_CLASS = "jce-overlay";
function overlayFor(canvas) {
  const layer = canvas.canvasEl;
  let svg = layer.querySelector(`svg.${OVERLAY_CLASS}`);
  if (!svg) {
    svg = document.createElementNS(NS, "svg");
    svg.classList.add(OVERLAY_CLASS);
    layer.prepend(svg);
  }
  return svg;
}
function segmentsFor(canvas) {
  const hidden = hiddenByFold(canvas);
  const out = [];
  for (const root of rootIds(canvas)) {
    const tree = treeOf(canvas, root);
    const walk = (id) => {
      if (hidden.has(id)) return;
      const parent = canvas.nodes.get(id);
      if (!parent) return;
      for (const childId of tree.children.get(id) ?? []) {
        if (hidden.has(childId)) continue;
        const child = canvas.nodes.get(childId);
        if (!child) continue;
        out.push(connector(parent, child, tree.layout));
        walk(childId);
      }
    };
    walk(root);
  }
  return out;
}
function drawOverlay(canvas) {
  const svg = overlayFor(canvas);
  const segments = segmentsFor(canvas);
  if (!segments.length) {
    svg.replaceChildren();
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    styleOverlay(svg, 0, 0, 0, 0);
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of segments) {
    for (const pt of pointsOf(seg)) {
      minX = Math.min(minX, pt[0]);
      minY = Math.min(minY, pt[1]);
      maxX = Math.max(maxX, pt[0]);
      maxY = Math.max(maxY, pt[1]);
    }
  }
  const pad = 8;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  svg.setAttribute("viewBox", `${minX} ${minY} ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  styleOverlay(svg, minX, minY, w, h);
  const frag = document.createDocumentFragment();
  for (const seg of segments) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", seg.d);
    path.setAttribute("class", "jce-mm-path");
    frag.appendChild(path);
    const head = document.createElementNS(NS, "polygon");
    head.setAttribute("points", seg.arrow);
    head.setAttribute("class", "jce-mm-arrow");
    frag.appendChild(head);
  }
  svg.replaceChildren(frag);
}
function styleOverlay(svg, left, top, w, h) {
  svg.style.position = "absolute";
  svg.style.left = `${left}px`;
  svg.style.top = `${top}px`;
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;
  svg.style.overflow = "visible";
  svg.style.pointerEvents = "none";
}
function pointsOf(seg) {
  const nums = seg.d.match(/-?\d+(\.\d+)?/g) ?? [];
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push([Number(nums[i]), Number(nums[i + 1])]);
  }
  const poly = seg.arrow.match(/-?\d+(\.\d+)?/g) ?? [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    out.push([Number(poly[i]), Number(poly[i + 1])]);
  }
  return out;
}

// src/chrome.ts
var KIND_CLASSES = ["jce-note", "jce-text", "jce-mindmap", "jce-section"];
var IFRAME_STYLE_ID = "jce-iframe-style";
var MINDMAP_IFRAME_CSS = `
html, body {
  background: transparent !important;
  background-color: transparent !important;
  margin: 0 !important;
}
:root {
  --background-primary: transparent !important;
  --background-primary-alt: transparent !important;
  --background-secondary: transparent !important;
  --background-secondary-alt: transparent !important;
  --background-modifier-form-field: transparent !important;
  --code-background: transparent !important;
  --embed-background: transparent !important;
  --canvas-color: transparent !important;
}
.markdown-source-view, .markdown-reading-view, .markdown-preview-view,
.cm-editor, .cm-scroller, .cm-content, .cm-contentContainer, .cm-line,
.markdown-embed, .markdown-embed-content {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
}
.cm-editor { height: 100% !important; }
.cm-scroller {
  overflow: hidden !important;
  font-size: var(--font-text-size, 16px);
}
.cm-content {
  text-align: center !important;
  padding: 6px 10px !important;
  min-height: 0 !important;
}
`;
var Chrome = class {
  constructor(plugin, onApplied) {
    this.plugin = plugin;
    this.onApplied = onApplied;
    this.observers = /* @__PURE__ */ new WeakMap();
    this.signatures = /* @__PURE__ */ new WeakMap();
    this.scheduled = /* @__PURE__ */ new WeakSet();
    this.paintedFrames = /* @__PURE__ */ new WeakSet();
  }
  attach(canvas) {
    if (this.observers.has(canvas)) {
      this.schedule(canvas);
      return;
    }
    const observer = new MutationObserver(() => this.schedule(canvas));
    observer.observe(canvas.canvasEl, { childList: true, subtree: true });
    this.observers.set(canvas, observer);
    this.schedule(canvas);
  }
  detach(canvas) {
    this.observers.get(canvas)?.disconnect();
    this.observers.delete(canvas);
    this.signatures.delete(canvas);
  }
  schedule(canvas) {
    if (this.scheduled.has(canvas)) return;
    this.scheduled.add(canvas);
    requestAnimationFrame(() => {
      this.scheduled.delete(canvas);
      this.sync(canvas);
    });
  }
  /** Force the next sync to do full work (after structural changes). */
  invalidate(canvas) {
    this.signatures.delete(canvas);
    this.schedule(canvas);
  }
  sync(canvas) {
    const signature = this.signatureOf(canvas);
    if (this.signatures.get(canvas) === signature) return;
    this.signatures.set(canvas, signature);
    this.apply(canvas);
  }
  signatureOf(canvas) {
    const parts = [];
    for (const node of allNodes(canvas)) {
      parts.push(
        [
          node.id,
          kindOf(node) ?? "-",
          Math.round(node.x),
          Math.round(node.y),
          Math.round(node.width),
          Math.round(node.height),
          node.color ?? "",
          isEditing(node) ? "e" : "",
          node.getData().jceFold === true ? "f" : ""
        ].join(":")
      );
    }
    for (const node of canvas.selection ?? []) parts.push(`s${node.id}`);
    parts.sort();
    return parts.join("|");
  }
  apply(canvas) {
    const mmIds = mindmapNodeIds(canvas);
    for (const node of allNodes(canvas)) {
      this.paintNode(node);
    }
    const mmSelected = Array.from(canvas.selection ?? []).some((n) => mmIds.has(n.id));
    canvas.wrapperEl.classList.toggle("jce-mm-selected", mmSelected);
    const hidden = hiddenByFold(canvas);
    for (const node of allNodes(canvas)) {
      const isMm = mmIds.has(node.id);
      node.nodeEl.classList.toggle("jce-mm-hidden", isMm && hidden.has(node.id));
      const folded = node.getData().jceFold === true;
      node.nodeEl.classList.toggle("jce-has-fold", isMm && folded);
    }
    for (const edge of mindmapEdges(canvas)) {
      edge.lineGroupEl?.classList.add("jce-hide-native");
      edge.lineEndGroupEl?.classList.add("jce-hide-native");
    }
    this.paintFrames(canvas, mmIds);
    drawOverlay(canvas);
    this.onApplied?.(canvas);
  }
  paintNode(node) {
    const kind = kindOf(node);
    const el = node.nodeEl;
    if (!el) return;
    for (const cls of KIND_CLASSES) {
      if (!kind || cls !== `jce-${kind}`) el.classList.remove(cls);
    }
    if (kind) {
      el.classList.add("jce-node", `jce-${kind}`);
      el.classList.toggle("jce-section-tinted", kind === "section" && !!node.color);
    }
  }
  /** Editing happens inside a same-origin iframe that Obsidian recreates each
   *  time; paint it on every appearance. */
  paintFrames(canvas, mmIds) {
    for (const node of allNodes(canvas)) {
      if (!mmIds.has(node.id)) continue;
      const frames = node.nodeEl.querySelectorAll("iframe");
      frames.forEach((frame) => {
        this.paintFrame(frame);
        if (!this.paintedFrames.has(frame)) {
          this.paintedFrames.add(frame);
          frame.addEventListener("load", () => this.paintFrame(frame));
        }
      });
    }
  }
  paintFrame(frame) {
    let doc = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc?.documentElement) return;
    let style = doc.getElementById(IFRAME_STYLE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = IFRAME_STYLE_ID;
      (doc.head ?? doc.documentElement).appendChild(style);
    }
    if (style.textContent !== MINDMAP_IFRAME_CSS) style.textContent = MINDMAP_IFRAME_CSS;
  }
};

// src/connect.ts
var ConnectTool = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.canvas = null;
    this.from = null;
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt) => this.onPointerDown(evt),
      true
    );
  }
  get active() {
    return !!this.canvas;
  }
  enter(canvas) {
    this.exit();
    this.canvas = canvas;
    canvas.wrapperEl.classList.add("jce-connecting");
  }
  exit() {
    this.clearFrom();
    this.canvas?.wrapperEl.classList.remove("jce-connecting");
    this.canvas = null;
  }
  onPointerDown(evt) {
    if (!this.canvas) return;
    if (evt.button !== 0) return;
    if (isInsideCanvasUi(evt.target)) return;
    const node = nodeFromEvent(this.canvas, evt);
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation?.();
    if (!node) {
      this.clearFrom();
      return;
    }
    if (!this.from) {
      this.from = node;
      node.nodeEl.classList.add("jce-connect-from");
      return;
    }
    if (this.from.id === node.id) {
      this.clearFrom();
      return;
    }
    const sides = autoSides(this.from, node);
    createEdge(this.canvas, this.from, node, sides);
    this.clearFrom();
  }
  clearFrom() {
    this.from?.nodeEl.classList.remove("jce-connect-from");
    this.from = null;
  }
};

// src/format.ts
var import_view = require("@codemirror/view");
var BUTTONS = [
  { id: "bold", glyph: "B", label: "\u7C97\u4F53 / Bold" },
  { id: "italic", glyph: "I", label: "\u659C\u4F53 / Italic" },
  { id: "underline", glyph: "U", label: "\u4E0B\u5212\u7EBF / Underline" },
  { id: "code", glyph: "</>", label: "\u884C\u5185\u4EE3\u7801 / Inline code" },
  { id: "highlight", glyph: "H", label: "\u9AD8\u4EAE / Highlight" },
  { id: "strike", glyph: "S", label: "\u5220\u9664\u7EBF / Strikethrough" },
  { id: "link", glyph: "\u2197", label: "\u94FE\u63A5 / Link" },
  { id: "math", glyph: "\u2211", label: "\u6570\u5B66 / Math" },
  { id: "color", glyph: "A", label: "\u6587\u5B57\u989C\u8272 / Text color" },
  { id: "bg", glyph: "\u25A7", label: "\u80CC\u666F\u8272 / Background color" }
];
var TEXT_COLORS = ["#111111", "#6b6b6b", "#c0392b", "#d35400", "#1e8449", "#1a5276", "#6c3483"];
var BG_COLORS = ["#f7e89c", "#c8efc4", "#c5e4f7", "#f5c6d0", "#e4e4e4"];
var FormatBar = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.hooked = /* @__PURE__ */ new WeakSet();
    this.followFrame = 0;
    this.syncTimer = 0;
    this.el = document.createElement("div");
    this.el.className = "jce-format-bar";
    this.el.hidden = true;
    this.colorBox = document.createElement("div");
    this.colorBox.className = "jce-format-pop jce-format-swatches";
    this.colorBox.hidden = true;
    this.linkBox = document.createElement("div");
    this.linkBox.className = "jce-format-pop";
    this.linkBox.hidden = true;
    this.linkInput = document.createElement("input");
    this.build();
    document.body.appendChild(this.el);
    this.plugin.register(() => {
      this.hide();
      this.el.remove();
    });
    this.plugin.registerDomEvent(document, "mouseup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "keyup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "selectionchange", () => this.schedule());
    this.plugin.registerDomEvent(document, "wheel", () => this.schedule(), true);
    this.plugin.registerDomEvent(window, "resize", () => this.schedule());
  }
  // -------------------------------------------------------------------- ui
  build() {
    const row = document.createElement("div");
    row.className = "jce-format-row";
    for (const btn of BUTTONS) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "jce-format-btn";
      el.dataset.fmt = btn.id;
      el.title = btn.label;
      el.setAttribute("aria-label", btn.label);
      el.textContent = btn.glyph;
      el.addEventListener("mousedown", (evt) => evt.preventDefault());
      el.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.run(btn.id);
      });
      row.appendChild(el);
    }
    this.el.appendChild(row);
    this.linkInput.type = "text";
    this.linkInput.placeholder = "https://";
    this.linkInput.className = "jce-format-input";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "jce-format-apply";
    apply.textContent = "\u786E\u5B9A";
    apply.addEventListener("mousedown", (evt) => evt.preventDefault());
    apply.addEventListener("click", (evt) => {
      evt.preventDefault();
      const target = this.resolve();
      if (target) this.applyLink(target, this.linkInput.value.trim());
      this.linkBox.hidden = true;
      this.schedule();
    });
    this.linkInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        apply.click();
      } else if (evt.key === "Escape") {
        this.linkBox.hidden = true;
      }
      evt.stopPropagation();
    });
    this.linkBox.append(this.linkInput, apply);
    this.el.append(this.linkBox, this.colorBox);
  }
  hide() {
    this.el.hidden = true;
    this.colorBox.hidden = true;
    this.linkBox.hidden = true;
    if (this.followFrame) {
      cancelAnimationFrame(this.followFrame);
      this.followFrame = 0;
    }
  }
  // --------------------------------------------------------------- resolve
  /** The editing surface under the current text selection, if any. */
  resolve() {
    for (const frame of this.frames()) {
      let doc = null;
      try {
        doc = frame.contentDocument;
      } catch {
        continue;
      }
      if (!doc) continue;
      this.hook(doc);
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) continue;
      const content = doc.querySelector(".cm-content");
      if (!content) continue;
      const view2 = findView(content);
      if (view2 && !view2.state.selection.main.empty) return { view: view2, frame };
    }
    const active = document.activeElement;
    const view = active instanceof HTMLElement ? findView(active) : null;
    if (view && !view.state.selection.main.empty) return { view, frame: null };
    return null;
  }
  frames() {
    const canvas = this.activeCanvas();
    const root = canvas?.canvasEl ?? document;
    return Array.from(root.querySelectorAll(".canvas-node iframe"));
  }
  activeCanvas() {
    const view = this.plugin.app.workspace.activeLeaf?.view;
    return view?.canvas ?? null;
  }
  /** Hook every editing iframe on a canvas (they are recreated per session). */
  hookCanvas(canvas) {
    const frames = Array.from(
      canvas.canvasEl.querySelectorAll(".canvas-node iframe")
    );
    if (!frames.length) return;
    for (const frame of frames) {
      let doc = null;
      try {
        doc = frame.contentDocument;
      } catch {
        continue;
      }
      if (doc) this.hook(doc);
    }
  }
  hook(doc) {
    if (this.hooked.has(doc)) return;
    this.hooked.add(doc);
    const kick = () => this.schedule();
    doc.addEventListener("mouseup", kick, true);
    doc.addEventListener("keyup", kick, true);
    doc.addEventListener("selectionchange", kick);
    doc.addEventListener("scroll", kick, true);
  }
  // ------------------------------------------------------------- placement
  /** Screen-space rect of the current selection, scale-corrected. */
  selectionRect(target) {
    const main = target.view.state.selection.main;
    if (main.empty) return null;
    const coords = target.view.coordsAtPos;
    if (typeof coords !== "function") return null;
    const a = coords.call(target.view, main.from, 1);
    const b = coords.call(target.view, main.to, -1);
    if (!a || !b) return null;
    const left = Math.min(a.left, b.left);
    const right2 = Math.max(a.right ?? a.left, b.right ?? b.left);
    const top = Math.min(a.top, b.top);
    const bottom2 = Math.max(a.bottom, b.bottom);
    const inner = new DOMRect(left, top, Math.max(1, right2 - left), Math.max(1, bottom2 - top));
    const frame = target.frame;
    if (!frame) return inner;
    const box = frame.getBoundingClientRect();
    const win = frame.contentWindow;
    const vw = win?.innerWidth || box.width || 1;
    const vh = win?.innerHeight || box.height || 1;
    const sx = box.width / vw;
    const sy = box.height / vh;
    return new DOMRect(
      box.left + inner.left * sx,
      box.top + inner.top * sy,
      inner.width * sx,
      inner.height * sy
    );
  }
  place(rect) {
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    const left = Math.min(
      window.innerWidth - width - 8,
      Math.max(8, rect.left + rect.width / 2 - width / 2)
    );
    const top = Math.max(8, rect.top - height - 8);
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }
  schedule() {
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.sync(), 0);
  }
  sync() {
    const target = this.resolve();
    if (!target) {
      this.hide();
      return;
    }
    const rect = this.selectionRect(target);
    if (!rect) {
      this.hide();
      return;
    }
    this.el.hidden = false;
    this.place(rect);
    this.startFollow();
  }
  startFollow() {
    if (this.followFrame) return;
    const tick = () => {
      if (this.el.hidden) {
        this.followFrame = 0;
        return;
      }
      const target = this.resolve();
      const rect = target ? this.selectionRect(target) : null;
      if (!rect) {
        this.hide();
        return;
      }
      this.place(rect);
      this.followFrame = requestAnimationFrame(tick);
    };
    this.followFrame = requestAnimationFrame(tick);
  }
  // --------------------------------------------------------------- actions
  run(id) {
    const target = this.resolve();
    if (!target) return;
    if (id === "link") {
      this.linkBox.hidden = !this.linkBox.hidden;
      if (!this.linkBox.hidden) this.linkInput.focus();
      return;
    }
    if (id === "color" || id === "bg") {
      this.showColors(target, id);
      return;
    }
    this.colorBox.hidden = true;
    this.linkBox.hidden = true;
    const pairs = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      underline: ["<u>", "</u>"],
      code: ["`", "`"],
      highlight: ["==", "=="],
      strike: ["~~", "~~"],
      math: ["$", "$"]
    };
    const pair = pairs[id];
    if (!pair) return;
    toggleWrap(target.view, pair[0], pair[1]);
    this.schedule();
  }
  applyLink(target, url) {
    const main = target.view.state.selection.main;
    const text = target.view.state.sliceDoc(main.from, main.to);
    if (!url) return;
    const label = text || url;
    const insert = `[${label}](${url})`;
    target.view.dispatch({
      changes: { from: main.from, to: main.to, insert },
      selection: { anchor: main.from + insert.length }
    });
    target.view.focus();
  }
  showColors(target, kind) {
    this.linkBox.hidden = true;
    this.colorBox.hidden = false;
    this.colorBox.replaceChildren();
    const colors = kind === "color" ? TEXT_COLORS : ["clear", ...BG_COLORS];
    for (const hex of colors) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "jce-swatch";
      if (hex === "clear") {
        swatch.classList.add("is-clear");
        swatch.title = "\u6E05\u9664 / Clear";
      } else {
        swatch.style.background = hex;
        swatch.title = hex;
      }
      swatch.addEventListener("mousedown", (evt) => evt.preventDefault());
      swatch.addEventListener("click", (evt) => {
        evt.preventDefault();
        if (hex === "clear") clearStyle(target.view, kind === "color" ? "color" : "background-color");
        else
          wrapStyle(
            target.view,
            kind === "color" ? "color" : "background-color",
            hex
          );
        this.colorBox.hidden = true;
        this.schedule();
      });
      this.colorBox.appendChild(swatch);
    }
  }
};
function findView(el) {
  try {
    const view = import_view.EditorView.findFromDOM(el);
    if (view && view.state?.selection) return view;
  } catch {
  }
  return null;
}
function toggleWrap(view, left, right2) {
  const main = view.state.selection.main;
  const text = view.state.sliceDoc(main.from, main.to);
  if (!text) return;
  if (text.length >= left.length + right2.length && text.startsWith(left) && text.endsWith(right2)) {
    const inner = text.slice(left.length, text.length - right2.length);
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: inner },
      selection: { anchor: main.from, head: main.from + inner.length }
    });
  } else {
    const insert = left + text + right2;
    view.dispatch({
      changes: { from: main.from, to: main.to, insert },
      selection: {
        anchor: main.from + left.length,
        head: main.from + left.length + text.length
      }
    });
  }
  view.focus();
}
var stylePattern = (prop, value) => new RegExp(`^<span style="${prop}:\\s*${escapeRe(value)}\\s*">([\\s\\S]*)</span>$`);
var anyStylePattern = (prop) => new RegExp(`^<span style="${prop}:\\s*[^"]+\\s*">([\\s\\S]*)</span>$`);
function wrapStyle(view, prop, value) {
  const main = view.state.selection.main;
  const text = view.state.sliceDoc(main.from, main.to);
  if (!text) return;
  const same = text.match(stylePattern(prop, value));
  if (same) {
    view.dispatch({ changes: { from: main.from, to: main.to, insert: same[1] } });
    view.focus();
    return;
  }
  const existing = text.match(anyStylePattern(prop));
  const inner = existing ? existing[1] : text;
  const insert = `<span style="${prop}: ${value}">${inner}</span>`;
  view.dispatch({
    changes: { from: main.from, to: main.to, insert },
    selection: { anchor: main.from + insert.length }
  });
  view.focus();
}
function clearStyle(view, prop) {
  const main = view.state.selection.main;
  const text = view.state.sliceDoc(main.from, main.to);
  const existing = text.match(anyStylePattern(prop));
  if (!existing) return;
  view.dispatch({ changes: { from: main.from, to: main.to, insert: existing[1] } });
  view.focus();
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/copy.ts
var TOOLS = {
  select: { id: "select", zh: "\u9009\u62E9", en: "Select", key: "V" },
  connect: { id: "connect", zh: "\u8FDE\u7EBF", en: "Connect", key: "C" },
  note: { id: "note", zh: "\u7B14\u8BB0\u5361", en: "Note card", key: "N" },
  text: { id: "text", zh: "\u6587\u5B57", en: "Text", key: "T" },
  mindmap: { id: "mindmap", zh: "\u601D\u7EF4\u5BFC\u56FE", en: "Mindmap", key: "M" },
  section: { id: "section", zh: "\u5206\u533A", en: "Section", key: "G" }
};
var MENU = {
  color: { zh: "\u989C\u8272", en: "Color" },
  remove: { zh: "\u79FB\u9664", en: "Remove" },
  fold: { zh: "\u6298\u53E0", en: "Fold" },
  unfold: { zh: "\u5C55\u5F00", en: "Unfold" },
  rotate: { zh: "\u65CB\u8F6C", en: "Rotate" }
};
var DEFAULTS = {
  noteCard: "Note Card",
  section: "Section",
  mindmapRoot: "Mindmap",
  text: ""
};
function tooltip(tool) {
  return tool.key ? `${tool.zh} / ${tool.en}  ${tool.key}` : `${tool.zh} / ${tool.en}`;
}
function menuLabel(item) {
  return `${item.zh} / ${item.en}`;
}

// src/icons.ts
var ICONS = {
  select: `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M5.5 3.8l6 16.2 2.3-6.1 6.1-2.3-14.4-7.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  connect: `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><circle cx="6.4" cy="12" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.6" cy="12" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 12h7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  note: `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><rect x="4.8" y="4.5" width="14.4" height="15" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 9.2h8M8 12.4h8M8 15.6h4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  text: `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M6 7.2h12M12 7.2v10.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  mindmap: `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><rect x="8.4" y="3.6" width="7.2" height="4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="3.4" y="16.4" width="6.4" height="4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="14.2" y="16.4" width="6.4" height="4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.6v4.2M6.6 16.4v-2.2h10.8v2.2M12 11.8v2.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  section: `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><rect x="3.8" y="5.6" width="16.4" height="12.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3.2 2.6"/></svg>`
};

// src/toolbar.ts
var CanvasToolbar = class {
  constructor(onPick) {
    this.onPick = onPick;
    this.current = "select";
    this.el = document.createElement("div");
    this.el.className = "jce-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Canvas \u589E\u5F3A");
    const order = ["select", "connect", "note", "text", "mindmap", "section"];
    order.forEach((id, index) => {
      if (index === 2) {
        const sep = document.createElement("div");
        sep.className = "jce-tool-sep";
        this.el.appendChild(sep);
      }
      const meta = TOOLS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "jce-tool";
      btn.dataset.tool = id;
      btn.title = tooltip(meta);
      btn.setAttribute("aria-label", tooltip(meta));
      btn.innerHTML = ICONS[id] ?? "";
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.onPick(id);
      });
      this.el.appendChild(btn);
    });
    this.setActive("select");
  }
  setActive(id) {
    this.current = id;
    this.el.querySelectorAll(".jce-tool").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tool === id);
    });
  }
  getActive() {
    return this.current;
  }
  detach() {
    this.el.remove();
  }
};

// src/menus.ts
var import_obsidian = require("obsidian");
var PALETTE = [
  { id: "", label: "\u9ED8\u8BA4 / Default", swatch: "#d8d8d8" },
  { id: "1", label: "\u7EA2 / Red", swatch: "#fb464c" },
  { id: "2", label: "\u6A59 / Orange", swatch: "#e9973f" },
  { id: "3", label: "\u9EC4 / Yellow", swatch: "#e0de71" },
  { id: "4", label: "\u7EFF / Green", swatch: "#44cf6e" },
  { id: "5", label: "\u9752 / Cyan", swatch: "#53c9e1" },
  { id: "6", label: "\u7D2B / Purple", swatch: "#a882ff" }
];
var CREATE_ORDER = ["note", "text", "mindmap", "section"];
var ContextMenus = class {
  constructor(plugin, handlers) {
    this.plugin = plugin;
    this.handlers = handlers;
    this.open = null;
    this.closedAt = 0;
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt) => this.onPointerDown(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "contextmenu",
      (evt) => this.onContextMenu(evt),
      true
    );
  }
  get menuOpen() {
    return !!this.open;
  }
  onPointerDown(evt) {
    const target = evt.target;
    if (this.open) {
      if (target?.closest?.(".menu")) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.hide();
      return;
    }
    if (Date.now() - this.closedAt < 150) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }
  hide() {
    this.open?.hide();
    this.open = null;
    this.closedAt = Date.now();
  }
  onContextMenu(evt) {
    const target = evt.target;
    if (isInsideCanvasUi(target)) return;
    const wrapper = target?.closest?.(".canvas-wrapper");
    if (!(wrapper instanceof HTMLElement)) return;
    const canvas = canvasFromWrapper(this.plugin, wrapper);
    if (!canvas) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.hide();
    const node = nodeFromWrapper(canvas, target);
    const menu = new import_obsidian.Menu();
    if (node) this.buildObjectMenu(menu, canvas, node);
    else this.buildBlankMenu(menu, canvas, canvas.posFromEvt(evt));
    this.open = menu;
    menu.onHide(() => {
      if (this.open === menu) this.open = null;
      this.closedAt = Date.now();
    });
    menu.showAtMouseEvent(evt);
  }
  buildBlankMenu(menu, canvas, at) {
    for (const kind of CREATE_ORDER) {
      const meta = TOOLS[kind];
      menu.addItem(
        (item) => item.setTitle(menuLabel(meta)).setIcon(ICON_FOR[kind]).onClick(() => this.handlers.create(canvas, kind, at))
      );
    }
  }
  buildObjectMenu(menu, canvas, node) {
    menu.addItem((item) => {
      item.setTitle(menuLabel(MENU.color)).setIcon("palette");
      const sub = item.setSubmenu?.();
      const target = sub ?? menu;
      for (const color of PALETTE) {
        target.addItem(
          (row) => row.setTitle(color.label).setChecked((node.color ?? "") === color.id).onClick(() => this.handlers.setColor(canvas, node.id, color.id))
        );
      }
    });
    menu.addItem(
      (item) => item.setTitle(menuLabel(MENU.remove)).setIcon("trash").onClick(() => this.handlers.remove(canvas, node.id))
    );
    if (isMindmap(node)) {
      if (hasChildren(canvas, node.id)) {
        const folded = isFolded(canvas, node.id);
        const item = folded ? MENU.unfold : MENU.fold;
        menu.addItem(
          (row) => row.setTitle(menuLabel(item)).setIcon(folded ? "chevrons-down-up" : "chevrons-up-down").onClick(() => this.handlers.setFolded(canvas, node.id, !folded))
        );
      }
      menu.addItem(
        (row) => row.setTitle(menuLabel(MENU.rotate)).setIcon("rotate-cw").onClick(() => this.handlers.rotate(canvas, node.id))
      );
    }
  }
};
var ICON_FOR = {
  note: "sticky-note",
  text: "type",
  mindmap: "network",
  section: "frame"
};
function canvasFromWrapper(plugin, wrapper) {
  for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
    const view = leaf.view;
    if (view.canvas?.wrapperEl === wrapper) return view.canvas;
  }
  const active = plugin.app.workspace.activeLeaf?.view;
  return active?.canvas ?? null;
}
function nodeFromWrapper(canvas, target) {
  const el = target?.closest?.(".canvas-node");
  if (!(el instanceof HTMLElement)) return null;
  for (const node of canvas.nodes.values()) {
    if (node.nodeEl === el || node.nodeEl.contains(el) || el.contains(node.nodeEl)) return node;
  }
  return null;
}

// src/objects.ts
function createObject(chrome, opts) {
  const { canvas, kind } = opts;
  const size = KIND_SIZE[kind];
  const pos = opts.at ? { x: Math.round(opts.at.x - size.width / 2), y: Math.round(opts.at.y - size.height / 2) } : viewportCenter(canvas, size);
  let node;
  if (kind === "section") {
    node = canvas.createGroupNode({
      pos,
      size,
      label: DEFAULTS.section,
      focus: false,
      save: true
    });
    if (node) tag(canvas, node, "section");
  } else {
    const text = kind === "note" ? `# ${DEFAULTS.noteCard}
` : kind === "mindmap" ? DEFAULTS.mindmapRoot : DEFAULTS.text;
    node = canvas.createTextNode({ pos, size, text, focus: false, save: true });
    if (node) {
      tag(canvas, node, kind);
      if (kind === "mindmap") {
        node.setData({ ...node.getData(), [ROOT]: node.id, [LAYOUT]: "TB" });
        canvas.requestSave();
      }
    }
  }
  if (!node) return void 0;
  commit(canvas);
  chrome.invalidate(canvas);
  if (kind !== "section" && opts.startEditing !== false) {
    startEditingWhenReady(canvas, node);
  } else {
    canvas.selectOnly(node);
  }
  return node;
}
function tag(canvas, node, kind) {
  node.setData({ ...node.getData(), [TAG]: kind });
  canvas.requestSave();
}
function startEditingWhenReady(canvas, node, tries = 0) {
  const el = node.nodeEl;
  if (!el?.isConnected) {
    if (tries > 20) return;
    canvas.requestFrame();
    requestAnimationFrame(() => startEditingWhenReady(canvas, node, tries + 1));
    return;
  }
  if (!node.isEditing) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      canvas.wrapperEl.focus?.();
    }
    const lazyNode = node;
    if (tries > 0) {
      lazyNode.attach?.();
      lazyNode.render?.();
    }
    canvas.selectOnly(node);
    node.startEditing?.();
  }
  if (tries < 30) {
    canvas.requestFrame();
    requestAnimationFrame(() => {
      const live = canvas.nodes.get(node.id) ?? node;
      if (!live.isEditing) startEditingWhenReady(canvas, live, tries + 1);
    });
  }
}

// src/mindmap.ts
var SIDES = {
  TB: { from: "bottom", to: "top" },
  BT: { from: "top", to: "bottom" },
  LR: { from: "right", to: "left" },
  RL: { from: "left", to: "right" }
};
var MindmapController = class {
  constructor(plugin, chrome) {
    this.plugin = plugin;
    this.chrome = chrome;
    this.drag = null;
    this.installPointerDrag();
  }
  // ---------------------------------------------------------------- children
  /** PRD MM-03..MM-06: create a real child node, keep existing siblings put,
   *  inherit size, and wire the parent→child arrow before editing starts. */
  addChild(canvas, parentId) {
    const parent = canvas.nodes.get(parentId);
    if (!parent || !isMindmap(parent)) return void 0;
    const rootId = rootIdOf(parent) ?? parent.id;
    const tree = treeOf(canvas, rootId);
    const layout = tree.layout;
    const siblings = childrenOf(canvas, parentId);
    const size = inheritedSize(parent, siblings.map((s) => ({ width: s.width, height: s.height })));
    const pos = childPosition(parent, siblings, size, layout);
    const child = canvas.createTextNode({ pos, size, text: "", focus: false, save: true });
    if (!child) return void 0;
    child.setData({ ...child.getData(), [TAG]: "mindmap", [ROOT]: rootId });
    if (dataOf(parent).jceFold === true) {
      parent.setData({ ...parent.getData(), jceFold: false });
    }
    createEdge(canvas, parent, child, SIDES[layout]);
    commit(canvas);
    this.chrome.invalidate(canvas);
    startEditingWhenReady(canvas, child);
    return child;
  }
  // -------------------------------------------------------------------- fold
  setFolded(canvas, nodeId, folded) {
    const node = canvas.nodes.get(nodeId);
    if (!node) return;
    node.setData({ ...node.getData(), jceFold: folded });
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }
  folded(canvas, nodeId) {
    return isFolded(canvas, nodeId);
  }
  // ------------------------------------------------------------------ rotate
  /**
   * Rotate the branch direction by 90° clockwise (TB → LR → BT → RL).
   * PRD MM-10 requires a Rotate action but leaves direction/step open; this is
   * a documented proposal, not a confirmed user decision.
   */
  rotate(canvas, nodeId) {
    const node = canvas.nodes.get(nodeId);
    if (!node || !isMindmap(node)) return;
    const rootId = rootIdOf(node) ?? node.id;
    const root = canvas.nodes.get(rootId);
    if (!root) return;
    const layout = nextLayout(dataOf(root)[LAYOUT] ?? "TB");
    root.setData({ ...root.getData(), [LAYOUT]: layout });
    this.relayout(canvas, root, layout);
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }
  /** Re-place descendants of `root` for a new orientation; root itself stays. */
  relayout(canvas, root, layout) {
    const walk = (parent) => {
      const kids = childrenOf(canvas, parent.id);
      const placed = [];
      for (const kid of kids) {
        const size = { width: kid.width, height: kid.height };
        const pos = childPosition(parent, placed, size, layout);
        kid.moveAndResize?.({ ...pos, width: size.width, height: size.height });
        placed.push({ ...pos, ...size });
        const edge = Array.from(canvas.edges.values()).find(
          (e) => e.from.node.id === parent.id && e.to.node.id === kid.id
        );
        edge?.update?.(
          { node: parent, side: SIDES[layout].from, end: "none" },
          { node: kid, side: SIDES[layout].to, end: "arrow" }
        );
        walk(kid);
      }
    };
    walk(root);
  }
  // ------------------------------------------------------------ subtree drag
  /**
   * PRD MM-09: dragging a parent (or any middle node) moves the whole subtree.
   *
   * Instead of fighting Obsidian's drag manager by writing positions from a
   * pointermove handler, we pre-select the subtree on pointerdown so the
   * native drag moves every descendant with correct edge/z-index updates.
   */
  installPointerDrag() {
    this.plugin.registerDomEvent(
      document,
      "pointerdown",
      (evt) => this.onPointerDown(evt),
      true
    );
    this.plugin.registerDomEvent(
      document,
      "pointermove",
      (evt) => {
        const drag = this.drag;
        if (!drag) return;
        if (Math.abs(evt.clientX - drag.x) > 3 || Math.abs(evt.clientY - drag.y) > 3) {
          drag.moved = true;
        }
      },
      true
    );
    const finish = () => this.onPointerUp();
    this.plugin.registerDomEvent(document, "pointerup", finish, true);
    this.plugin.registerDomEvent(window, "pointerup", finish, true);
  }
  onPointerDown(evt) {
    this.drag = null;
    if (evt.button !== 0) return;
    if (evt.shiftKey || evt.metaKey || evt.ctrlKey || evt.altKey) return;
    const view = activeCanvasView(this.plugin);
    if (!view) return;
    const canvas = view;
    if (isInsideCanvasUi(evt.target)) return;
    const node = nodeFromEvent(canvas, evt);
    if (!node || !isMindmap(node)) return;
    if (isEditing(node)) return;
    const rootId = rootIdOf(node) ?? node.id;
    const tree = treeOf(canvas, rootId);
    const subtree = [node.id, ...collectDescendants(tree, node.id)];
    if (subtree.length < 2) return;
    canvas.deselectAll();
    for (const id of subtree) {
      const member = canvas.nodes.get(id);
      if (member) canvas.select(member);
    }
    this.drag = { canvas, nodeId: node.id, moved: false, x: evt.clientX, y: evt.clientY };
  }
  onPointerUp() {
    const drag = this.drag;
    this.drag = null;
    if (!drag || !drag.moved) {
      const node = drag?.canvas.nodes.get(drag.nodeId);
      if (node) {
        drag.canvas.deselectAll();
        drag.canvas.selectOnly(node);
      }
    }
    if (drag) this.chrome.schedule(drag.canvas);
  }
  // ------------------------------------------------------------------ create
  /** Wrap an existing plain canvas text node into a mindmap root. */
  adoptAsRoot(canvas, node) {
    node.setData({ ...node.getData(), [TAG]: "mindmap", [ROOT]: node.id, [LAYOUT]: "TB" });
    canvas.requestSave();
    this.chrome.invalidate(canvas);
  }
  rootIds(canvas) {
    return rootIds(canvas);
  }
  /** The mindmap node currently selected or being edited, if any. */
  activeNode(canvas) {
    const selected = selectedNodes(canvas).filter((n) => kindOf(n) === "mindmap");
    if (selected.length === 1) return selected[0];
    for (const node of canvas.nodes.values()) {
      if (isEditing(node) && isMindmap(node)) return node;
    }
    return void 0;
  }
  isRoot(canvas, nodeId) {
    const node = canvas.nodes.get(nodeId);
    return !!node && isMindmap(node) && rootIdOf(node) === nodeId;
  }
  static defaultSize() {
    return KIND_SIZE.mindmap;
  }
};
function collectDescendants(tree, id) {
  const out = [];
  const walk = (current) => {
    for (const child of tree.children.get(current) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}
function activeCanvasView(plugin) {
  const view = plugin.app.workspace.activeLeaf?.view;
  if (!view || view.getViewType?.() !== "canvas") return null;
  return view.canvas ?? null;
}

// src/main.ts
var TOOL_KEYS = {
  v: "select",
  c: "connect",
  n: "note",
  t: "text",
  m: "mindmap",
  g: "section"
};
var CanvasEnhancePlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.toolbars = /* @__PURE__ */ new Map();
    this.placing = null;
    this.hookedDocs = /* @__PURE__ */ new WeakSet();
    this.frameHooks = /* @__PURE__ */ new WeakSet();
  }
  async onload() {
    this.chrome = new Chrome(this, (canvas) => this.hookFrames(canvas));
    this.mindmap = new MindmapController(this, this.chrome);
    this.formats = new FormatBar(this);
    this.connect = new ConnectTool(this);
    this.menus = new ContextMenus(this, {
      create: (canvas, kind, at) => {
        createObject(this.chrome, { canvas, kind, at });
        this.setPlacing(null);
        this.setActive(canvas, "select");
      },
      remove: (canvas, nodeId) => this.removeNode(canvas, nodeId),
      setColor: (canvas, nodeId, color) => this.setColor(canvas, nodeId, color),
      rotate: (canvas, nodeId) => this.mindmap.rotate(canvas, nodeId),
      setFolded: (canvas, nodeId, folded) => this.mindmap.setFolded(canvas, nodeId, folded)
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("file-open", () => window.setTimeout(() => this.sync(), 60)));
    this.registerDomEvent(document, "keydown", (evt) => this.onKey(evt), true);
    this.registerDomEvent(document, "pointermove", (evt) => this.onPointerMove(evt), true);
    this.registerDomEvent(
      document,
      "pointerdown",
      (evt) => {
        if (this.placing) this.onPlaceClick(evt);
        this.syncSelectionChrome();
      },
      true
    );
    this.registerDomEvent(document, "pointerup", () => this.syncSelectionChrome(), true);
    this.addCommand({
      id: "create-section",
      name: "\u65B0\u5EFA\u5206\u533A / Create Section",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) {
          createObject(this.chrome, {
            canvas,
            kind: "section",
            at: viewportCenter(canvas, KIND_SIZE.section)
          });
        }
        return true;
      }
    });
    this.addCommand({
      id: "add-mindmap-child",
      name: "\u65B0\u5EFA\u5BFC\u56FE\u5B50\u8282\u70B9 / Add mindmap child",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        const node = this.activeMindmapNode(canvas);
        if (!node) return false;
        if (!checking) this.mindmap.addChild(canvas, node.id);
        return true;
      }
    });
    this.sync();
  }
  onunload() {
    this.setPlacing(null);
    this.connect.exit();
    this.formats.hide();
    for (const canvas of this.toolbars.keys()) this.chrome.detach(canvas);
    for (const bar of this.toolbars.values()) bar.detach();
    this.toolbars.clear();
  }
  // ------------------------------------------------------------- lifecycle
  sync() {
    const seen = /* @__PURE__ */ new Set();
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      const canvas = canvasOf(leaf);
      if (!canvas || seen.has(canvas)) continue;
      seen.add(canvas);
      this.chrome.attach(canvas);
      this.ensureToolbar(leaf, canvas);
      this.hookFrames(canvas);
      this.patchFrame(canvas);
    }
    for (const [canvas, bar] of Array.from(this.toolbars)) {
      if (seen.has(canvas)) continue;
      bar.detach();
      this.chrome.detach(canvas);
      this.toolbars.delete(canvas);
    }
  }
  ensureToolbar(leaf, canvas) {
    const host = leaf.view.contentEl;
    if (!host) return;
    const existing = this.toolbars.get(canvas);
    if (existing && host.contains(existing.el)) return;
    existing?.detach();
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const bar = new CanvasToolbar((tool) => this.onTool(canvas, tool));
    host.appendChild(bar.el);
    this.toolbars.set(canvas, bar);
  }
  /** Keep the overlay honest while nodes are being dragged. */
  patchFrame(canvas) {
    if (this.frameHooks.has(canvas)) return;
    this.frameHooks.add(canvas);
    const original = canvas.requestFrame.bind(canvas);
    canvas.requestFrame = () => {
      original();
      this.chrome.schedule(canvas);
    };
  }
  /** Hooking iframes lets Tab create children while the caret is inside one. */
  hookFrames(canvas) {
    this.formats.hookCanvas(canvas);
    for (const node of canvas.nodes.values()) {
      node.nodeEl.querySelectorAll("iframe").forEach((frame) => {
        let doc = null;
        try {
          doc = frame.contentDocument;
        } catch {
          return;
        }
        if (!doc || this.hookedDocs.has(doc)) return;
        this.hookedDocs.add(doc);
        doc.addEventListener(
          "keydown",
          (evt) => {
            if (evt.key !== "Tab" || evt.metaKey || evt.ctrlKey || evt.altKey) return;
            const owner = nodeById(canvas, node.id);
            if (!owner || !isMindmap(owner)) return;
            evt.preventDefault();
            evt.stopPropagation();
            owner.blur?.();
            this.mindmap.addChild(canvas, owner.id);
          },
          true
        );
      });
    }
  }
  onPointerMove(evt) {
    if (evt.buttons === 0) return;
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }
  syncSelectionChrome() {
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }
  // ----------------------------------------------------------------- tools
  onTool(canvas, tool) {
    this.setActive(canvas, tool);
    if (tool === "select") {
      this.setPlacing(null);
      this.connect.exit();
      return;
    }
    if (tool === "connect") {
      this.setPlacing(null);
      this.connect.enter(canvas);
      return;
    }
    this.connect.exit();
    this.setPlacing({ canvas, kind: tool });
  }
  setPlacing(next) {
    if (this.placing) this.placing.canvas.wrapperEl.classList.remove("jce-placing");
    this.placing = next;
    if (next) next.canvas.wrapperEl.classList.add("jce-placing");
  }
  onPlaceClick(evt) {
    const placing = this.placing;
    if (!placing) return;
    if (evt.button !== 0) return;
    if (!placing.canvas.wrapperEl.contains(evt.target)) return;
    if (isInsideCanvasUi(evt.target)) return;
    evt.preventDefault();
    evt.stopPropagation();
    const at = placing.canvas.posFromEvt(evt);
    createObject(this.chrome, { canvas: placing.canvas, kind: placing.kind, at });
    this.setPlacing(null);
    this.setActive(placing.canvas, "select");
  }
  setActive(canvas, tool) {
    this.toolbars.get(canvas)?.setActive(tool);
  }
  // -------------------------------------------------------------- keyboard
  onKey(evt) {
    if (evt.defaultPrevented) return;
    if (evt.isComposing) return;
    const canvas = activeCanvas(this.app);
    if (!canvas) return;
    if (evt.key === "Escape") {
      this.setPlacing(null);
      this.connect.exit();
      this.formats.hide();
      this.setActive(canvas, "select");
      return;
    }
    if (evt.metaKey || evt.ctrlKey) {
      if (!evt.shiftKey && !evt.altKey && evt.key.toLowerCase() === "g") {
        if (isTyping(evt.target)) return;
        evt.preventDefault();
        createObject(this.chrome, {
          canvas,
          kind: "section",
          at: viewportCenter(canvas, KIND_SIZE.section)
        });
        this.setActive(canvas, "select");
      }
      return;
    }
    if (evt.key === "Tab") {
      if (isTyping(evt.target)) return;
      const node = this.activeMindmapNode(canvas);
      if (!node) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.mindmap.addChild(canvas, node.id);
      return;
    }
    if (isTyping(evt.target)) return;
    if (evt.altKey || evt.shiftKey) return;
    const tool = TOOL_KEYS[evt.key.toLowerCase()];
    if (!tool) return;
    evt.preventDefault();
    this.onTool(canvas, tool);
    if (tool !== "select" && tool !== "connect") {
      this.setPlacing(null);
      createObject(this.chrome, {
        canvas,
        kind: tool,
        at: viewportCenter(canvas, KIND_SIZE[tool])
      });
      this.setActive(canvas, "select");
    }
  }
  /**
   * The mindmap node Tab applies to. Dragging pre-selects a whole subtree, so
   * with several nodes selected we take the topmost one (the one that is not a
   * descendant of another selected node) — that is the node the user clicked.
   */
  activeMindmapNode(canvas) {
    const selected = selectedNodes(canvas).filter((n) => isMindmap(n));
    if (selected.length === 1) return selected[0];
    if (selected.length > 1) {
      const ids = new Set(selected.map((n) => n.id));
      const roots = selected.filter((n) => {
        const rootId = rootIdOf(n) ?? n.id;
        const tree = treeOf(canvas, rootId);
        for (const other of ids) {
          if (other === n.id) continue;
          if (descendantsOf(tree, other).includes(n.id)) return false;
        }
        return true;
      });
      if (roots.length === 1) return roots[0];
    }
    for (const node of canvas.nodes.values()) {
      if (isMindmap(node) && isEditing(node)) return node;
    }
    return void 0;
  }
  // --------------------------------------------------------------- actions
  setColor(canvas, nodeId, color) {
    const node = canvas.nodes.get(nodeId);
    if (!node) return;
    node.setColor?.(color);
    const next = { ...node.getData() };
    if (color) next.color = color;
    else delete next.color;
    node.setData(next);
    this.chrome.paintNode(node);
    this.chrome.invalidate(canvas);
    commit(canvas);
  }
  /**
   * Removing a mindmap node removes its descendants too — leaving orphans
   * behind would silently break the hierarchy. PRD §10.1 marks the treatment
   * of descendants as undecided, so this is a documented proposal.
   */
  removeNode(canvas, nodeId) {
    const node = canvas.nodes.get(nodeId);
    if (!node) return;
    const ids = [nodeId];
    if (isMindmap(node)) {
      const rootId = rootIdOf(node) ?? node.id;
      ids.push(...descendantsOf(treeOf(canvas, rootId), nodeId));
    }
    deleteNodes(canvas, ids);
    this.chrome.invalidate(canvas);
  }
};
function canvasOf(leaf) {
  const view = leaf.view;
  return view.canvas ?? null;
}
function activeCanvas(app) {
  const leaf = app.workspace.activeLeaf;
  if (!leaf) return null;
  if (leaf.view.getViewType?.() !== "canvas") return null;
  return canvasOf(leaf);
}
function nodeById(canvas, id) {
  return canvas.nodes.get(id);
}
function isTyping(target) {
  if (document.activeElement instanceof HTMLIFrameElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "IFRAME") return true;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;
  const tag2 = target.tagName;
  if (tag2 === "INPUT" || tag2 === "TEXTAREA" || tag2 === "SELECT") return true;
  return !!target.closest(".cm-editor, .cm-content");
}
