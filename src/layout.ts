/**
 * layout.ts — pure geometry for mindmap children and hierarchy lines.
 *
 * No Obsidian imports: this module is unit-testable in plain Node.
 *
 * The connector shape follows PRD MM-07: a stem leaves the parent's fixed
 * rectangle at the midpoint of one edge, runs into a shared trunk, then
 * branches with a rounded elbow to the midpoint of the child's facing edge.
 * A child that sits straight below/right of its parent degenerates to a
 * single straight line — that is the "中间孩子直竖" case.
 */

import type { Layout } from "./model";
import type { Point, Rect, Size, Side } from "./bridge";

export const CHILD_GAP = 56;
export const SIB_GAP = 36;
export const STEM = 20;
export const CORNER = 8;
export const ARROW = 7;
export const ARROW_HALF = 3.6;

/** Fixed mindmap node metrics (PRD MM-01/MM-02: fixed box, fixed padding). */
export const MM_SIZE: Size = { width: 180, height: 48 };
export const MM_PADDING = 8;

export const KIND_SIZE = {
  note: { width: 280, height: 200 },
  text: { width: 240, height: 72 },
  mindmap: MM_SIZE,
  section: { width: 560, height: 360 },
} as const;

export function rectOf(node: Rect): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

export function right(r: Rect): number {
  return r.x + r.width;
}

export function bottom(r: Rect): number {
  return r.y + r.height;
}

export function centerX(r: Rect): number {
  return r.x + r.width / 2;
}

export function centerY(r: Rect): number {
  return r.y + r.height / 2;
}

export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, right(r));
    maxY = Math.max(maxY, bottom(r));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** PRD MM-04: inherit the previous sibling's size, else the parent's size. */
export function inheritedSize(parent: Size, siblings: Size[]): Size {
  const source = siblings.length ? siblings[siblings.length - 1] : parent;
  return {
    width: Math.max(1, Math.round(source.width)),
    height: Math.max(1, Math.round(source.height)),
  };
}

/**
 * PRD MM-05 (final revision): a new child is placed *beside* existing
 * children. Existing nodes keep their coordinates — nothing is re-centred or
 * re-flowed.
 */
export function childPosition(
  parent: Rect,
  siblings: Rect[],
  size: Size,
  layout: Layout
): Point {
  const last = siblings[siblings.length - 1];
  switch (layout) {
    case "TB": {
      if (!last) {
        return {
          x: Math.round(centerX(parent) - size.width / 2),
          y: Math.round(bottom(parent) + CHILD_GAP),
        };
      }
      const far = Math.max(...siblings.map(right));
      return { x: Math.round(far + SIB_GAP), y: Math.round(last.y) };
    }
    case "BT": {
      if (!last) {
        return {
          x: Math.round(centerX(parent) - size.width / 2),
          y: Math.round(parent.y - CHILD_GAP - size.height),
        };
      }
      const far = Math.max(...siblings.map(right));
      return { x: Math.round(far + SIB_GAP), y: Math.round(last.y) };
    }
    case "LR": {
      if (!last) {
        return {
          x: Math.round(right(parent) + CHILD_GAP),
          y: Math.round(centerY(parent) - size.height / 2),
        };
      }
      const far = Math.max(...siblings.map(bottom));
      return { x: Math.round(last.x), y: Math.round(far + SIB_GAP) };
    }
    case "RL": {
      if (!last) {
        return {
          x: Math.round(parent.x - CHILD_GAP - size.width),
          y: Math.round(centerY(parent) - size.height / 2),
        };
      }
      const far = Math.max(...siblings.map(bottom));
      return { x: Math.round(last.x), y: Math.round(far + SIB_GAP) };
    }
  }
}

export type Connector = { d: string; arrow: string };

const vertical = (layout: Layout) => layout === "TB" || layout === "BT";
const forward = (layout: Layout) => layout === "TB" || layout === "LR";

/**
 * Build the hierarchy line from `parent` to `child`.
 *
 * `d` is an SVG path, `arrow` a polygon `points` string whose tip touches the
 * child's edge midpoint and points at the child.
 */
export function connector(parent: Rect, child: Rect, layout: Layout): Connector {
  const vert = vertical(layout);
  const sign = forward(layout) ? 1 : -1;
  const stem = STEM;

  // Points on the fixed rectangles (MM-07: edge midpoints, never glyph boxes).
  const start: Point = vert
    ? { x: centerX(parent), y: sign > 0 ? bottom(parent) : parent.y }
    : { x: sign > 0 ? right(parent) : parent.x, y: centerY(parent) };
  const end: Point = vert
    ? { x: centerX(child), y: sign > 0 ? child.y : bottom(child) }
    : { x: sign > 0 ? child.x : right(child), y: centerY(child) };

  const span = vert ? (end.y - start.y) * sign : (end.x - start.x) * sign;
  const offset = vert ? end.x - start.x : end.y - start.y;
  const dir = Math.sign(offset) || 1;

  // Arrow tip sits on the child edge; the path stops ARROW short so the head
  // reads as a solid triangle rather than overdrawing the line.
  const tip = end;
  const stop: Point = vert
    ? { x: end.x, y: end.y - sign * ARROW }
    : { x: end.x - sign * ARROW, y: end.y };

  let d: string;
  if (Math.abs(offset) < 0.5) {
    // Aligned child: one straight run ("中间孩子直竖").
    d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else if (span < stem + CORNER + 2) {
    // Not enough room for a trunk: curve straight across.
    const bend = Math.max(4, span * 0.5) * sign;
    d = vert
      ? `M ${fmt(start.x)} ${fmt(start.y)} ` +
        `C ${fmt(start.x)} ${fmt(start.y + bend)} ${fmt(stop.x)} ${fmt(stop.y - bend)} ` +
        `${fmt(stop.x)} ${fmt(stop.y)}`
      : `M ${fmt(start.x)} ${fmt(start.y)} ` +
        `C ${fmt(start.x + bend)} ${fmt(start.y)} ${fmt(stop.x - bend)} ${fmt(stop.y)} ` +
        `${fmt(stop.x)} ${fmt(stop.y)}`;
  } else if (vert) {
    // Trunk down (or up) from the parent edge, rounded elbow across, then a
    // vertical drop into the child's facing edge.
    const bx = start.x;
    const by = start.y + sign * stem;
    d =
      `M ${fmt(start.x)} ${fmt(start.y)} ` +
      `L ${fmt(bx)} ${fmt(by - sign * CORNER)} ` +
      `Q ${fmt(bx)} ${fmt(by)} ${fmt(bx + dir * CORNER)} ${fmt(by)} ` +
      `L ${fmt(stop.x - dir * CORNER)} ${fmt(by)} ` +
      `Q ${fmt(stop.x)} ${fmt(by)} ${fmt(stop.x)} ${fmt(by + sign * CORNER)} ` +
      `L ${fmt(stop.x)} ${fmt(stop.y)}`;
  } else {
    const bx = start.x + sign * stem;
    const by = start.y;
    d =
      `M ${fmt(start.x)} ${fmt(start.y)} ` +
      `L ${fmt(bx - sign * CORNER)} ${fmt(by)} ` +
      `Q ${fmt(bx)} ${fmt(by)} ${fmt(bx)} ${fmt(by + dir * CORNER)} ` +
      `L ${fmt(bx)} ${fmt(stop.y - dir * CORNER)} ` +
      `Q ${fmt(bx)} ${fmt(stop.y)} ${fmt(bx + sign * CORNER)} ${fmt(stop.y)} ` +
      `L ${fmt(stop.x)} ${fmt(stop.y)}`;
  }

  const arrow = vert
    ? `${fmt(tip.x)},${fmt(tip.y)} ${fmt(tip.x - ARROW_HALF)},${fmt(tip.y - sign * ARROW)} ${fmt(
        tip.x + ARROW_HALF
      )},${fmt(tip.y - sign * ARROW)}`
    : `${fmt(tip.x)},${fmt(tip.y)} ${fmt(tip.x - sign * ARROW)},${fmt(tip.y - ARROW_HALF)} ${fmt(
        tip.x - sign * ARROW
      )},${fmt(tip.y + ARROW_HALF)}`;

  return { d, arrow };
}

/** Side of a rectangle facing `other` (used for plain connections). */
export function facingSide(rect: Rect, other: Rect): Side {
  const dx = centerX(other) - centerX(rect);
  const dy = centerY(other) - centerY(rect);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
