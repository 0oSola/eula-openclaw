export function createVmdPreviewInteraction(asset) {
  return {
    emotion: asset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: asset?.url || "",
    sequence: [],
  };
}
