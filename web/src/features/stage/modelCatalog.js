export function getModelDisplayLabel(model) {
  if (model?.label?.trim()) return model.label.trim();
  const relativePath = `${model?.relative_path || ""}`.trim();
  if (relativePath.includes("/")) {
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
  }
  const name = `${model?.name || ""}`.trim();
  return name.replace(/\.(pmx|pmd)$/i, "") || "Unknown Model";
}

export function pickInitialModelSelection(models, preferredRelativePath = "") {
  if (!Array.isArray(models) || models.length === 0) return null;
  return models.find((item) => item?.relative_path === preferredRelativePath) || models[0] || null;
}
