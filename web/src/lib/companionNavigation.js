/** @typedef {"overview" | "chat" | "tasks" | "tools" | "memory" | "skills"} RightPanelView */
/** @typedef {{ kind: "page", href: string } | { kind: "panel", view: RightPanelView }} CompanionNavTarget */

/** @type {Record<string, RightPanelView>} */
const panelTargets = {
  menu: "overview",
  chat: "chat",
  tools: "tools",
  memory: "memory",
  skills: "skills",
};

/**
 * @param {"menu" | "chat" | "tasks" | "tools" | "memory" | "skills"} key
 * @returns {CompanionNavTarget}
 */
export function resolveCompanionNavTarget(key) {
  if (key === "tasks") {
    return { kind: "page", href: "/companion/tasks" };
  }

  return { kind: "panel", view: panelTargets[key] || "overview" };
}
