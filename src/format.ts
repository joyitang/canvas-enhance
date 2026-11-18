/**
 * format.ts — text-selection format bar (PRD §6).
 *
 * Two details drive the design:
 *
 * 1. Canvas text nodes are edited inside a same-origin iframe that Obsidian
 *    recreates for every edit session. We therefore resolve the CodeMirror
 *    view through `EditorView.findFromDOM` on the iframe's `.cm-content`
 *    instead of guessing at focus/activeElement.
 * 2. The canvas scales that iframe with a CSS transform, so an inner rect must
 *    be mapped to screen space through the iframe's actual scale ratio.
 *    Ignoring that ratio is what puts the bar in the wrong place when zoomed.
 */

import { EditorView } from "@codemirror/view";
import type { Plugin } from "obsidian";
import { CanvasLike } from "./bridge";

type FormatId =
  | "bold"
  | "italic"
  | "underline"
  | "code"
  | "highlight"
  | "strike"
  | "link"
  | "math"
  | "color"
  | "bg";

const BUTTONS: { id: FormatId; glyph: string; label: string }[] = [
  { id: "bold", glyph: "B", label: "粗体 / Bold" },
  { id: "italic", glyph: "I", label: "斜体 / Italic" },
  { id: "underline", glyph: "U", label: "下划线 / Underline" },
  { id: "code", glyph: "</>", label: "行内代码 / Inline code" },
  { id: "highlight", glyph: "H", label: "高亮 / Highlight" },
  { id: "strike", glyph: "S", label: "删除线 / Strikethrough" },
  { id: "link", glyph: "↗", label: "链接 / Link" },
  { id: "math", glyph: "∑", label: "数学 / Math" },
  { id: "color", glyph: "A", label: "文字颜色 / Text color" },
  { id: "bg", glyph: "▧", label: "背景色 / Background color" },
];

const TEXT_COLORS = ["#111111", "#6b6b6b", "#c0392b", "#d35400", "#1e8449", "#1a5276", "#6c3483"];
const BG_COLORS = ["#f7e89c", "#c8efc4", "#c5e4f7", "#f5c6d0", "#e4e4e4"];

type Target = {
  view: EditorView;
  frame: HTMLIFrameElement | null;
};

export class FormatBar {
  private el: HTMLElement;
  private colorBox: HTMLElement;
  private linkBox: HTMLElement;
  private linkInput: HTMLInputElement;
  private hooked = new WeakSet<Document>();
  private followFrame = 0;
  private syncTimer = 0;

  constructor(private plugin: Plugin) {
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
    // Reloading the plugin must not leave an orphan bar behind.
    this.plugin.register(() => {
      this.hide();
      this.el.remove();
    });

    this.plugin.registerDomEvent(document, "mouseup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "keyup", () => this.schedule(), true);
    this.plugin.registerDomEvent(document, "selectionchange", () => this.schedule());
    // Panning/zooming must *move* the bar, not dismiss it (PRD FMT-03), so we
    // do not hide on outside clicks; sync() hides it once the selection is gone.
    this.plugin.registerDomEvent(document, "wheel", () => this.schedule(), true);
    this.plugin.registerDomEvent(window, "resize", () => this.schedule());
  }

  // -------------------------------------------------------------------- ui

  private build(): void {
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
    apply.textContent = "确定";
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

  hide(): void {
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
  private resolve(): Target | null {
    for (const frame of this.frames()) {
      let doc: Document | null = null;
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
      const view = findView(content as HTMLElement);
      if (view && !view.state.selection.main.empty) return { view, frame };
    }

    // Fallback: an inline CodeMirror editor (future/no-iframe rendering).
    const active = document.activeElement;
    const view = active instanceof HTMLElement ? findView(active) : null;
    if (view && !view.state.selection.main.empty) return { view, frame: null };
    return null;
  }

  private frames(): HTMLIFrameElement[] {
    const canvas = this.activeCanvas();
    const root = canvas?.canvasEl ?? document;
    return Array.from(root.querySelectorAll<HTMLIFrameElement>(".canvas-node iframe"));
  }

  private activeCanvas(): CanvasLike | null {
    const view = this.plugin.app.workspace.activeLeaf?.view as { canvas?: CanvasLike } | undefined;
    return view?.canvas ?? null;
  }

  /** Hook every editing iframe on a canvas (they are recreated per session). */
  hookCanvas(canvas: CanvasLike): void {
    const frames = Array.from(
      canvas.canvasEl.querySelectorAll<HTMLIFrameElement>(".canvas-node iframe")
    );
    if (!frames.length) return;
    for (const frame of frames) {
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        continue;
      }
      if (doc) this.hook(doc);
    }
  }

  private hook(doc: Document): void {
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
  private selectionRect(target: Target): DOMRect | null {
    const main = target.view.state.selection.main;
    if (main.empty) return null;
    const coords = target.view.coordsAtPos;
    if (typeof coords !== "function") return null;
    const a = coords.call(target.view, main.from, 1);
    const b = coords.call(target.view, main.to, -1);
    if (!a || !b) return null;

    const left = Math.min(a.left, b.left);
    const right = Math.max(a.right ?? a.left, b.right ?? b.left);
    const top = Math.min(a.top, b.top);
    const bottom = Math.max(a.bottom, b.bottom);
    const inner = new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));

    const frame = target.frame;
    if (!frame) return inner;
    const box = frame.getBoundingClientRect();
    const win = frame.contentWindow;
    const vw = win?.innerWidth || box.width || 1;
    const vh = win?.innerHeight || box.height || 1;
    // Canvas zoom scales the iframe; the document inside keeps its own units.
    const sx = box.width / vw;
    const sy = box.height / vh;
    return new DOMRect(
      box.left + inner.left * sx,
      box.top + inner.top * sy,
      inner.width * sx,
      inner.height * sy
    );
  }

  private place(rect: DOMRect): void {
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

  private schedule(): void {
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.sync(), 0);
  }

  private sync(): void {
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

  private startFollow(): void {
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

  private run(id: FormatId): void {
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

    const pairs: Partial<Record<FormatId, [string, string]>> = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      underline: ["<u>", "</u>"],
      code: ["`", "`"],
      highlight: ["==", "=="],
      strike: ["~~", "~~"],
      math: ["$", "$"],
    };
    const pair = pairs[id];
    if (!pair) return;
    toggleWrap(target.view, pair[0], pair[1]);
    this.schedule();
  }

  private applyLink(target: Target, url: string): void {
    const main = target.view.state.selection.main;
    const text = target.view.state.sliceDoc(main.from, main.to);
    if (!url) return;
    const label = text || url;
    const insert = `[${label}](${url})`;
    target.view.dispatch({
      changes: { from: main.from, to: main.to, insert },
      selection: { anchor: main.from + insert.length },
    });
    target.view.focus();
  }

  private showColors(target: Target, kind: "color" | "bg"): void {
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
        swatch.title = "清除 / Clear";
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
}

// ------------------------------------------------------------------ helpers

function findView(el: HTMLElement): EditorView | null {
  try {
    const view = EditorView.findFromDOM(el);
    if (view && view.state?.selection) return view;
  } catch {
    /* not inside an editor */
  }
  return null;
}

function toggleWrap(view: EditorView, left: string, right: string): void {
  const main = view.state.selection.main;
  const text = view.state.sliceDoc(main.from, main.to);
  if (!text) return;
  if (text.length >= left.length + right.length && text.startsWith(left) && text.endsWith(right)) {
    const inner = text.slice(left.length, text.length - right.length);
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: inner },
      selection: { anchor: main.from, head: main.from + inner.length },
    });
  } else {
    const insert = left + text + right;
    view.dispatch({
      changes: { from: main.from, to: main.to, insert },
      selection: {
        anchor: main.from + left.length,
        head: main.from + left.length + text.length,
      },
    });
  }
  view.focus();
}

const stylePattern = (prop: string, value: string) =>
  new RegExp(`^<span style="${prop}:\\s*${escapeRe(value)}\\s*">([\\s\\S]*)</span>$`);

const anyStylePattern = (prop: string) =>
  new RegExp(`^<span style="${prop}:\\s*[^"]+\\s*">([\\s\\S]*)</span>$`);

function wrapStyle(view: EditorView, prop: string, value: string): void {
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
    selection: { anchor: main.from + insert.length },
  });
  view.focus();
}

function clearStyle(view: EditorView, prop: string): void {
  const main = view.state.selection.main;
  const text = view.state.sliceDoc(main.from, main.to);
  const existing = text.match(anyStylePattern(prop));
  if (!existing) return;
  view.dispatch({ changes: { from: main.from, to: main.to, insert: existing[1] } });
  view.focus();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
