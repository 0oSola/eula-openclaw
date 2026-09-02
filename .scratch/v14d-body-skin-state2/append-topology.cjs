const fs = require("fs");
const p = "docs/architecture/current-system-topology.md";
let s = fs.readFileSync(p, "utf8");
const anchor = "两种 cwd 均可运行）。";
const i = s.indexOf(anchor);
if (i < 0) { console.error("anchor not found"); process.exit(1); }
const add = "\r\n\r\nStage 2B-M3.1（codex/v14d-bodyskin-semantic-pixel-gate，2026-09-02）修复 BodySkin 语义分区与真逐像素 Gate：区域归属从「世界 y 带 + x 符号」改为版本化骨骼主导权重集合（V14D_BODY_SKIN_BONE_REGIONS_V1，顶点主导骨骼 → neck/torso/leftHand/rightHand），解决旧版左手 y 带误吞腰腹皮肤；Gate 参考采样改 GPU 口径双线性（替代最近点），MAE 改为真逐像素逐通道 mean(abs(web_i-ref_i))（替代均值差，消除正负误差抵消），Face 与 BodySkin 强制同一像素样本集合（numerator/denominator），正式 Gate 消费 draw-call 级绑定证据（exportBodySkinDrawBinding），新增语义负测（左右手交换/腰腹注入/UV 集合错位/均值抵消构造）。概念登记见 workflow/concepts/v14d-bodyskin-bone-semantic-region.zh-CN.md。仅诊断入口生效，生产默认入口、PMX/VMD/骨骼/物理/播放链零改动。";
s = s.slice(0, i + anchor.length) + add + s.slice(i + anchor.length);
fs.writeFileSync(p, s, "utf8");
console.log("topology updated");
