export function collectImportableVmdFiles(fileListLike) {
  return Array.from(fileListLike || []).filter((file) => {
    const name = `${file?.name || ""}`.trim().toLowerCase();
    return name.endsWith(".vmd");
  });
}
