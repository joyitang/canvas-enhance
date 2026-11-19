/**
 * model.ts — object kinds and mindmap structure.
 *
 * Types are stored in the canvas file itself, on each node, as an extra
 * property (`getData()` re-emits unknown properties). Parent/child relations
 * are stored as real canvas edges, so the structure survives restarts, file
 * copies and other devices without any sidecar database.
 */

import { CanvasLike, EdgeLike, NodeLike, RawNode } from "./bridge";

export type Kind = "note" | "text" | "mindmap" | "section";

export const TAG = "jce";
export const ROOT = "jceRoot";
export const LAYOUT = "jceLayout";
export const FOLD = "jceFold";
/** Card background chosen from the object menu (note cards only). */
export const CARD_BG = "jceBg";

/** Soft palette in the spirit of Heptabase's card colours. */
export const CARD_BG_PALETTE: { value: string; zh: string; en: string }[] = [
  { value: "", zh: "默认", en: "Default" },
  { value: "#ffffff", zh: "白", en: "White" },
  { value: "#fbf7ee", zh: "奶油", en: "Cream" },
  { value: "#fbf1c4", zh: "黄", en: "Yellow" },
  { value: "#e3f1d9", zh: "绿", en: "Green" },
  { value: "#dfeaf7", zh: "蓝", en: "Blue" },
  { value: "#f8e1e4", zh: "粉", en: "Pink" },
  { value: "#ece5f7", zh: "紫", en: "Purple" },
  { value: "#eeeeee", zh: "灰", en: "Grey" },
];

export function cardBgOf(node: NodeLike): string {
  const value = dataOf(node)[CARD_BG];
  return typeof value === "string" ? value : "";
}

export type Layout = "TB" | "LR" | "BT" | "RL";

export const LAYOUT_ORDER: Layout[] = ["TB", "LR", "BT", "RL"];

export function dataOf(node: NodeLike): RawNode {
  return node.getData();
}

export function kindOf(node: NodeLike): Kind | undefined {
  const kind = dataOf(node)[TAG];
  return kind === "note" || kind === "text" || kind === "mindmap" || kind === "section"
    ? kind
    : undefined;
}

export function isMindmap(node: NodeLike): boolean {
  return kindOf(node) === "mindmap";
}

export function rootIdOf(node: NodeLike): string | undefined {
  const id = dataOf(node)[ROOT];
  return typeof id === "string" ? id : undefined;
}

export function layoutOf(canvas: CanvasLike, rootId: string): Layout {
  const root = canvas.nodes.get(rootId);
  const raw = root ? dataOf(root)[LAYOUT] : undefined;
  return raw === "TB" || raw === "LR" || raw === "BT" || raw === "RL" ? raw : "TB";
}

export function nextLayout(layout: Layout): Layout {
  const i = LAYOUT_ORDER.indexOf(layout);
  return LAYOUT_ORDER[(i + 1) % LAYOUT_ORDER.length];
}

export type Tree = {
  rootId: string;
  layout: Layout;
  children: Map<string, string[]>;
  parent: Map<string, string>;
};

/** All mindmap nodes belonging to one root, plus their edge-derived structure. */
export function treeOf(canvas: CanvasLike, rootId: string): Tree {
  const members = new Set<string>();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node) && rootIdOf(node) === rootId) members.add(node.id);
  }
  members.add(rootId);

  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const id of members) children.set(id, []);

  for (const edge of canvas.edges.values()) {
    const from = edge.from.node.id;
    const to = edge.to.node.id;
    if (!members.has(from) || !members.has(to)) continue;
    if (parent.has(to)) continue;
    parent.set(to, from);
    children.get(from)!.push(to);
  }

  // A cycle-free tree is assumed; guard against orphaned entries anyway.
  for (const [child, par] of parent) {
    if (!members.has(par)) parent.delete(child);
  }

  return { rootId, layout: layoutOf(canvas, rootId), children, parent };
}

/** Every mindmap root currently present in the canvas. */
export function rootIds(canvas: CanvasLike): string[] {
  const out: string[] = [];
  for (const node of canvas.nodes.values()) {
    if (!isMindmap(node)) continue;
    const root = rootIdOf(node);
    if (root === node.id) out.push(node.id);
  }
  return out;
}

export function descendantsOf(tree: Tree, id: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const child of tree.children.get(current) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}

/** ids hidden because an ancestor is folded */
export function hiddenByFold(canvas: CanvasLike): Set<string> {
  const hidden = new Set<string>();
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

export function isFolded(canvas: CanvasLike, id: string): boolean {
  const node = canvas.nodes.get(id);
  return !!node && dataOf(node)[FOLD] === true;
}

export function hasChildren(canvas: CanvasLike, id: string): boolean {
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id === id && isMindmap(edge.to.node)) return true;
  }
  return false;
}

export function childrenOf(canvas: CanvasLike, id: string): NodeLike[] {
  const out: NodeLike[] = [];
  for (const edge of canvas.edges.values()) {
    if (edge.from.node.id !== id) continue;
    const child = canvas.nodes.get(edge.to.node.id);
    if (child && isMindmap(child)) out.push(child);
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y);
  return out;
}

/** Edges that belong to a mindmap (both endpoints are tagged mindmap). */
export function mindmapEdges(canvas: CanvasLike): EdgeLike[] {
  const out: EdgeLike[] = [];
  for (const edge of canvas.edges.values()) {
    if (isMindmap(edge.from.node) && isMindmap(edge.to.node)) out.push(edge);
  }
  return out;
}

export function mindmapNodeIds(canvas: CanvasLike): Set<string> {
  const ids = new Set<string>();
  for (const node of canvas.nodes.values()) {
    if (isMindmap(node)) ids.add(node.id);
  }
  return ids;
}
