/**
 * objects.ts — creating the four object types (PRD §5).
 *
 * Order matters: tag + wire the object first, then start editing. Starting an
 * edit session before the structure is final is what used to lose arrows.
 */

import {
  CanvasLike,
  NodeLike,
  Point,
  commit,
  uid,
  viewportCenter,
} from "./bridge";
import { Chrome } from "./chrome";
import { DEFAULTS } from "./copy";
import { KIND_SIZE } from "./layout";
import { LAYOUT, ROOT, TAG, Kind } from "./model";

export type CreateOptions = {
  canvas: CanvasLike;
  kind: Kind;
  /** world position of the click; the object is centred on it */
  at?: Point;
  startEditing?: boolean;
};

export function createObject(chrome: Chrome, opts: CreateOptions): NodeLike | undefined {
  const { canvas, kind } = opts;
  const size = KIND_SIZE[kind];
  const pos = opts.at
    ? { x: Math.round(opts.at.x - size.width / 2), y: Math.round(opts.at.y - size.height / 2) }
    : viewportCenter(canvas, size);

  let node: NodeLike | undefined;
  if (kind === "section") {
    node = canvas.createGroupNode({
      pos,
      size,
      label: DEFAULTS.section,
      focus: false,
      save: true,
    });
    if (node) tag(canvas, node, "section");
  } else {
    const text =
      kind === "note"
        ? `# ${DEFAULTS.noteCard}\n`
        : kind === "mindmap"
          ? DEFAULTS.mindmapRoot
          : DEFAULTS.text;
    node = canvas.createTextNode({ pos, size, text, focus: false, save: true });
    if (node) {
      tag(canvas, node, kind);
      if (kind === "mindmap") {
        node.setData({ ...node.getData(), [ROOT]: node.id, [LAYOUT]: "TB" });
        canvas.requestSave();
      }
    }
  }

  if (!node) return undefined;
  commit(canvas);
  chrome.invalidate(canvas);

  if (kind !== "section" && opts.startEditing !== false) {
    startEditingWhenReady(canvas, node);
  } else {
    canvas.selectOnly(node);
  }
  return node;
}

export function tag(canvas: CanvasLike, node: NodeLike, kind: Kind): void {
  node.setData({ ...node.getData(), [TAG]: kind });
  canvas.requestSave();
}

/**
 * Start editing once the node element is mounted *and* the canvas owns focus.
 *
 * Two failure modes this guards against, both observed for real:
 *  - the node element is not in the DOM yet (editing silently does nothing);
 *  - focus is on `body` after the previous edit session, so `startEditing`
 *    is a no-op and the new node looks created but cannot be typed into.
 */
export function startEditingWhenReady(canvas: CanvasLike, node: NodeLike, tries = 0): void {
  const el = node.nodeEl;
  if (!el?.isConnected) {
    if (tries > 20) return;
    canvas.requestFrame();
    requestAnimationFrame(() => startEditingWhenReady(canvas, node, tries + 1));
    return;
  }

  if (!node.isEditing) {
    // Give the canvas keyboard focus back before opening an editor.
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      canvas.wrapperEl.focus?.();
    }
    // A node created this frame may not be rendered yet; render() makes
    // startEditing meaningful instead of a silent no-op.
    const lazyNode = node as NodeLike & { attach?: () => void; render?: () => void };
    if (tries > 0) {
      lazyNode.attach?.();
      lazyNode.render?.();
    }
    canvas.selectOnly(node);
    node.startEditing?.();
  }

  // Verify, then retry — Obsidian can swallow the edit session when it races
  // with the teardown of the previous one (its fold-save debounce fires on a
  // destroyed markdown view). Give it up to ~30 frames to settle.
  if (tries < 30) {
    canvas.requestFrame();
    requestAnimationFrame(() => {
      const live = canvas.nodes.get(node.id) ?? node;
      if (!live.isEditing) startEditingWhenReady(canvas, live, tries + 1);
    });
  }
}

export function newId(): string {
  return uid();
}
