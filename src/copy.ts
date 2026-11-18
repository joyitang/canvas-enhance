/**
 * Locked UI copy — PRD §8.1 ("已校对锁定").
 * Do not change these strings without a new user-confirmed proofreading pass.
 */

export const TOOLS = {
  select: { id: "select", zh: "选择", en: "Select", key: "V" },
  connect: { id: "connect", zh: "连线", en: "Connect", key: "C" },
  note: { id: "note", zh: "笔记卡", en: "Note card", key: "N" },
  text: { id: "text", zh: "文字", en: "Text", key: "T" },
  mindmap: { id: "mindmap", zh: "思维导图", en: "Mindmap", key: "M" },
  section: { id: "section", zh: "分区", en: "Section", key: "G" },
} as const;

export type ToolId = keyof typeof TOOLS;

export const MENU = {
  color: { zh: "颜色", en: "Color" },
  remove: { zh: "移除", en: "Remove" },
  fold: { zh: "折叠", en: "Fold" },
  unfold: { zh: "展开", en: "Unfold" },
  rotate: { zh: "旋转", en: "Rotate" },
} as const;

export const DEFAULTS = {
  noteCard: "Note Card",
  section: "Section",
  mindmapRoot: "Mindmap",
  text: "",
} as const;

export function tooltip(tool: { zh: string; en: string; key?: string }): string {
  return tool.key ? `${tool.zh} / ${tool.en}  ${tool.key}` : `${tool.zh} / ${tool.en}`;
}

export function menuLabel(item: { zh: string; en: string }): string {
  return `${item.zh} / ${item.en}`;
}
