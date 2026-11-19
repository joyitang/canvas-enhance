/**
 * Canvas 增强 — Obsidian Canvas enhancement.
 *
 * Rebuilt against the PRD (Canvas增强-PRD-Gemini.md) and against the actual
 * Obsidian 1.15 Canvas internals; see bridge.ts for the verified assumptions.
 */

import { Plugin, WorkspaceLeaf } from "obsidian";
import {
  CanvasLike,
  NodeLike,
  Point,
  commit,
  deleteNodes,
  isEditing,
  isInsideCanvasUi,
  selectedNodes,
} from "./bridge";
import { Chrome } from "./chrome";
import { ConnectTool } from "./connect";
import { FormatBar } from "./format";
import { CanvasToolbar } from "./toolbar";
import { ContextMenus } from "./menus";
import { MindmapController } from "./mindmap";
import { createObject } from "./objects";
import { TodoController } from "./todo";
import { DEFAULTS, ToolId, TOOLS } from "./copy";
import { Kind, isMindmap, kindOf, rootIdOf, treeOf, descendantsOf, CARD_BG } from "./model";
import { viewportCenter } from "./bridge";
import { KIND_SIZE } from "./layout";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  c: "connect",
  n: "note",
  t: "text",
  m: "mindmap",
  g: "section",
  d: "todo",
};

export default class CanvasEnhancePlugin extends Plugin {
  private chrome!: Chrome;
  private mindmap!: MindmapController;
  private formats!: FormatBar;
  private connect!: ConnectTool;
  private menus!: ContextMenus;
  private todo!: TodoController;

  private toolbars = new Map<CanvasLike, CanvasToolbar>();
  private placing: { canvas: CanvasLike; kind: Kind; text?: string } | null = null;
  private hookedDocs = new WeakSet<Document>();
  private frameHooks = new WeakSet<CanvasLike>();

  async onload(): Promise<void> {
    this.chrome = new Chrome(this, (canvas) => this.hookFrames(canvas));
    this.mindmap = new MindmapController(this, this.chrome);
    this.formats = new FormatBar(this);
    this.todo = new TodoController(this);
    this.connect = new ConnectTool(this);
    this.menus = new ContextMenus(this, {
      create: (canvas, kind, at) => {
        createObject(this.chrome, { canvas, kind, at });
        this.setPlacing(null);
        this.setActive(canvas, "select");
      },
      remove: (canvas, nodeId) => this.removeNode(canvas, nodeId),
      setColor: (canvas, nodeId, color) => this.setColor(canvas, nodeId, color),
      setCardBg: (canvas, nodeId, color) => this.setCardBg(canvas, nodeId, color),
      rotate: (canvas, nodeId) => this.mindmap.rotate(canvas, nodeId),
      setFolded: (canvas, nodeId, folded) => this.mindmap.setFolded(canvas, nodeId, folded),
    });

    this.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.sync()));
    this.registerEvent(this.app.workspace.on("file-open", () => window.setTimeout(() => this.sync(), 60)));

    this.registerDomEvent(document, "keydown", (evt) => this.onKey(evt), true);
    // Window capture: a preview checkbox must win over the canvas node
    // selection, which would otherwise swallow the click.
    this.registerDomEvent(window, "pointerdown", (evt) => this.todo.onPointerDown(evt), true);
    this.registerDomEvent(window, "click", (evt) => this.todo.onClick(evt), true);
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
      name: "新建分区 / Create Section",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        if (!checking) {
          createObject(this.chrome, {
            canvas,
            kind: "section",
            at: viewportCenter(canvas, KIND_SIZE.section),
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "add-mindmap-child",
      name: "新建导图子节点 / Add mindmap child",
      checkCallback: (checking) => {
        const canvas = activeCanvas(this.app);
        if (!canvas) return false;
        const node = this.activeMindmapNode(canvas);
        if (!node) return false;
        if (!checking) this.mindmap.addChild(canvas, node.id);
        return true;
      },
    });

    this.sync();
  }

  onunload(): void {
    this.setPlacing(null);
    this.connect.exit();
    this.formats.hide();
    for (const canvas of this.toolbars.keys()) this.chrome.detach(canvas);
    for (const bar of this.toolbars.values()) bar.detach();
    this.toolbars.clear();
  }

  // ------------------------------------------------------------- lifecycle

  private sync(): void {
    const seen = new Set<CanvasLike>();
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

  private ensureToolbar(leaf: WorkspaceLeaf, canvas: CanvasLike): void {
    const host = (leaf.view as { contentEl?: HTMLElement }).contentEl;
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
  private patchFrame(canvas: CanvasLike): void {
    if (this.frameHooks.has(canvas)) return;
    this.frameHooks.add(canvas);
    const original = canvas.requestFrame.bind(canvas);
    canvas.requestFrame = () => {
      original();
      this.chrome.schedule(canvas);
    };
  }

  /** Hooking iframes lets Tab create children while the caret is inside one. */
  private hookFrames(canvas: CanvasLike): void {
    this.formats.hookCanvas(canvas);
    for (const node of canvas.nodes.values()) {
      node.nodeEl.querySelectorAll("iframe").forEach((frame) => {
        let doc: Document | null = null;
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
            if (this.todo.onKeyDown(evt, doc)) return;
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

  private onPointerMove(evt: PointerEvent): void {
    if (evt.buttons === 0) return;
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }

  private syncSelectionChrome(): void {
    const canvas = activeCanvas(this.app);
    if (canvas) this.chrome.schedule(canvas);
  }

  // ----------------------------------------------------------------- tools

  private onTool(canvas: CanvasLike, tool: ToolId): void {
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
    if (tool === "todo") {
      // A to-do is a note card that starts life as one empty task.
      this.setPlacing({ canvas, kind: "note", text: DEFAULTS.todo });
      return;
    }
    this.setPlacing({ canvas, kind: tool });
  }

  private setPlacing(next: { canvas: CanvasLike; kind: Kind; text?: string } | null): void {
    if (this.placing) this.placing.canvas.wrapperEl.classList.remove("jce-placing");
    this.placing = next;
    if (next) next.canvas.wrapperEl.classList.add("jce-placing");
  }

  private onPlaceClick(evt: PointerEvent): void {
    const placing = this.placing;
    if (!placing) return;
    if (evt.button !== 0) return;
    if (!placing.canvas.wrapperEl.contains(evt.target as Node)) return;
    if (isInsideCanvasUi(evt.target as Element)) return;
    evt.preventDefault();
    evt.stopPropagation();

    const at = placing.canvas.posFromEvt(evt as MouseEvent);
    createObject(this.chrome, {
      canvas: placing.canvas,
      kind: placing.kind,
      at,
      text: placing.text,
      caretAtEnd: !!placing.text,
    });
    this.setPlacing(null);
    this.setActive(placing.canvas, "select");
  }

  private setActive(canvas: CanvasLike, tool: ToolId): void {
    this.toolbars.get(canvas)?.setActive(tool);
  }

  // -------------------------------------------------------------- keyboard

  private onKey(evt: KeyboardEvent): void {
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
          at: viewportCenter(canvas, KIND_SIZE.section),
        });
        this.setActive(canvas, "select");
      }
      return;
    }

    if (evt.key === "Tab") {
      if (isTyping(evt.target)) return; // the iframe hook handles that case
      const node = this.activeMindmapNode(canvas);
      if (!node) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.mindmap.addChild(canvas, node.id);
      return;
    }

    // TOOL-01: typing must never be hijacked by tool shortcuts.
    if (isTyping(evt.target)) return;
    if (evt.altKey || evt.shiftKey) return;

    const tool = TOOL_KEYS[evt.key.toLowerCase()];
    if (!tool) return;
    evt.preventDefault();
    this.onTool(canvas, tool);
    if (tool !== "select" && tool !== "connect") {
      this.setPlacing(null);
      const kind: Kind = tool === "todo" ? "note" : tool;
      createObject(this.chrome, {
        canvas,
        kind,
        at: viewportCenter(canvas, KIND_SIZE[kind]),
        text: tool === "todo" ? DEFAULTS.todo : undefined,
        caretAtEnd: tool === "todo",
      });
      this.setActive(canvas, "select");
    }
  }

  /**
   * The mindmap node Tab applies to. Dragging pre-selects a whole subtree, so
   * with several nodes selected we take the topmost one (the one that is not a
   * descendant of another selected node) — that is the node the user clicked.
   */
  private activeMindmapNode(canvas: CanvasLike): NodeLike | undefined {
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
    return undefined;
  }

  // --------------------------------------------------------------- actions

  private setColor(canvas: CanvasLike, nodeId: string, color: string): void {
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

  /** Note-card background lives in the .canvas file (`jceBg`), so it survives
   *  restarts and travels with the file. */
  private setCardBg(canvas: CanvasLike, nodeId: string, color: string): void {
    const node = canvas.nodes.get(nodeId);
    if (!node || kindOf(node) !== "note") return;
    const next = { ...node.getData() };
    if (color) next[CARD_BG] = color;
    else delete next[CARD_BG];
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
  private removeNode(canvas: CanvasLike, nodeId: string): void {
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
}

// ------------------------------------------------------------------ helpers

function canvasOf(leaf: WorkspaceLeaf): CanvasLike | null {
  const view = leaf.view as { canvas?: CanvasLike };
  return view.canvas ?? null;
}

function activeCanvas(app: { workspace: { activeLeaf?: WorkspaceLeaf | null } }): CanvasLike | null {
  const leaf = app.workspace.activeLeaf;
  if (!leaf) return null;
  if ((leaf.view as { getViewType?: () => string }).getViewType?.() !== "canvas") return null;
  return canvasOf(leaf);
}

function nodeById(canvas: CanvasLike, id: string): NodeLike | undefined {
  return canvas.nodes.get(id);
}

function isTyping(target: EventTarget | null): boolean {
  if (document.activeElement instanceof HTMLIFrameElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "IFRAME") return true;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!target.closest(".cm-editor, .cm-content");
}

export { TOOLS };
export type { Point };
