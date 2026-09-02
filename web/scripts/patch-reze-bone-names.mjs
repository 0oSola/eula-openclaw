import fs from "node:fs";
import path from "node:path";
const NM = "D:/workspace/MMD project/web/node_modules/reze-engine";
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(fp);
  }
  return out;
}
for (const fp of walk(NM)) {
  const src = fs.readFileSync(fp, "utf8");
  if (src.includes("bones") && (src.includes("joints") || src.includes("skinning"))) {
    console.log("==", fp);
    src.split("\n").forEach((l, i) => {
      if (/bones|getSkinning|joints/i.test(l) && l.length < 200) console.log(" ", i + 1, l.trim().slice(0, 140));
    });
  }
}
