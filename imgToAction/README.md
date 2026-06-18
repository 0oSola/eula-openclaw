# Eula PMX/VMD Pose Fitting Handoff Package

这是给 Codex 接手实现的本地项目交接包。

## 快速入口

1. 先读 `PROJECT_SPEC.md`
2. 再读 `codex/AGENTS.md`
3. 用 `assets/pmx/优菈.pmx` 和 `assets/reference_images/` 做输入
4. 用 `calibration/` 中的 VMD/CSV 做骨骼轴向校准
5. 用 `schemas/example_pose_nodes_eula_signature.json` 作为动作节点 DSL 初始样例
6. 用 `samples/vmd/eula_stand_to_signature_pose_final.vmd` 作为当前手工样例动作

## 目录说明

- `assets/reference_images/`：6 张关键帧正/侧面参考图
- `assets/pmx/`：目标 PMX
- `calibration/`：骨骼轴向校准 VMD 和帧表
- `tools/`：本地校准/渲染辅助脚本
- `outputs/`：脚本生成的本地渲染、manifest 和 contact sheet
- `samples/vmd/`：测试生成过的样例 VMD
- `schemas/`：动作节点 DSL schema、样例、轴向映射模板
- `screenshots/`：加载测试 VMD 后的预览截图
- `reports/`：骨骼导出/打包报告
- `codex/AGENTS.md`：给 Codex 的工作指南

## MediaPipe 参考图关键点提取

`tools/extract_mediapipe_landmarks.py` 用 MediaPipe Pose Landmarker 的 IMAGE mode 批量处理多角度参考图，并把结果转换成项目已有 `reference_landmarks` JSON 结构。它只负责生成参考 landmark，不直接生成 VMD。

对当前生成图批次可这样运行：

```powershell
python imgToAction/tools/extract_mediapipe_landmarks.py `
  --input output/imagegen/eula-thinking-gesture `
  --model-asset imgToAction/assets/mediapipe/pose_landmarker_full.task `
  --out imgToAction/config/reference_landmarks.eula_thinking.json `
  --raw-out imgToAction/outputs/mediapipe/eula-thinking-gesture/raw_mediapipe_landmarks.json
```

如果已经有 raw MediaPipe JSON，可跳过 live detection，只做格式转换：

```powershell
python imgToAction/tools/extract_mediapipe_landmarks.py `
  --input output/imagegen/eula-thinking-gesture `
  --from-raw imgToAction/outputs/mediapipe/eula-thinking-gesture/raw_mediapipe_landmarks.json `
  --out imgToAction/config/reference_landmarks.eula_thinking.json
```

脚本会忽略 `_contact_sheet.png`，只读取 `frame_00_front.png`、`frame_00_side.png`、`frame_00_45.png` 这类命名的参考帧。输出中的 `low_confidence` 点需要人工复核，尤其是托腮手腕、肘部、脚踝和脚尖。

## MoMask 候选到 VMD 闭环

当前第一版文本生成动作链路不在本项目内启动 MoMask。MoMask / HumanML3D 环境仍由外部环境负责，本项目只接收已经生成的 22 关节 `.npy` 或 BVH 候选，然后完成骨架导入、Eula PMX 骨骼重定向、右手靠近下巴边缘约束、手型覆盖、质量评分和候选选择。

推荐给 MoMask 的首版动作描述：

```text
A person stands still in an elegant composed posture, slowly raises the right hand toward the chin, lightly rests the hand near the chin in a thoughtful gesture, while the other arm settles calmly near the waist. The head tilts slightly downward, the body remains stable and restrained, graceful and mature.
```

短提示词：

```text
A person stands still and slowly raises the right hand to the chin in a thoughtful pose, with the other hand resting near the waist.
```

外部 MoMask 生成多个 seed 后，用端到端 CLI 选择质量最高的非 blocking 候选：

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-npy path/to/seed_001.npy `
  --candidate-npy path/to/seed_002.npy `
  --out imgToAction/outputs/vmd/eula_thinking_chin_edge.vmd
```

BVH 候选可以直接并列接入：

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-bvh imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh `
  --out imgToAction/outputs/vmd/eula_thinking_chin_edge_from_bvh.vmd
```

如果只是验证 BVH 源动作经过当前重定向后是否被保留，先用 preserve 模式，不套 thinking 约束和手型覆盖：

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-bvh imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh `
  --mode preserve-source-motion `
  --run-dir imgToAction/outputs/actions/thinking_chin_edge/run_preserve_bvh `
  --out imgToAction/outputs/vmd/eula_bvh_preserve_smoke.vmd
```

也可以混合多个来源：

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-npy path/to/seed_001.npy `
  --candidate-bvh imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh `
  --out imgToAction/outputs/vmd/eula_thinking_chin_edge_best.vmd
```

调试时可以固定 run 目录：

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-npy path/to/seed_001.npy `
  --run-dir imgToAction/outputs/actions/thinking_chin_edge/run_debug `
  --out imgToAction/outputs/vmd/eula_thinking_chin_edge.vmd
```

默认输出结构：

```text
imgToAction/outputs/actions/thinking_chin_edge/run_YYYYMMDD_HHMMSS/
  candidates/
    candidate_001_seed_001/
      skeleton.json
      bvh_motion.json
      final_skeleton.json
      draft.vmd
      final_candidate.vmd
      quality_report.json
      retarget_fidelity_report.json
  selection_report.json
  final.vmd
```

`draft.vmd` 是未应用 contact/hand overlay 的基础重定向结果；默认 `--mode action-fit` 下，`final_candidate.vmd` 是应用右手下巴边缘约束和手型 preset 后的候选。`--mode preserve-source-motion` 下，`final_candidate.vmd` 直接来自未约束的基础重定向结果，不生成 `final_skeleton.json`，不应用手型 preset，并写出 `retarget_fidelity_report.json`。`selection_report.json` 记录所有候选分数、blocking violation 和最终选择。

当前限制：

- v1 只内置 `thinking_chin_edge`，目标是右手腕靠近下巴边缘。
- MoMask `.npy` 期望形状为 `(frames, 22, 3)`，如果外部环境关节顺序不同，只改 `tools/import_momask_joints.py` 的 `MOMASK_JOINT_NAMES`。
- BVH 当前按 HumanML/IK 常见命名映射：`Hips`、`RightArm`、`RightForeArm`、`RightHand`、`LeftArm`、`LeftForeArm`、`LeftHand`、`RightUpLeg`、`RightLeg`、`RightFoot` 等；如果导出的 BVH 命名不同，先改 `tools/import_bvh_motion.py` 的 `DEFAULT_JOINT_MAP`。
- Eula PMX 手臂链重定向按模型 T/A-pose 处理：右上臂/右肘/右手首使用 `-X` rest axis，左侧使用 `+X` rest axis，再朝导入 skeleton 的关节方向旋转。不要把这些骨骼当成“默认向下”的 HumanML rest axis，否则渲染会接近双臂展开。
- 当前 `thinking_chin_edge` action-fit 的 Eula contact offset 是通过渲染闭环校准后的 `[0.12, 0.105, 0.09]`，验证截图在 `imgToAction/outputs/actions/thinking_chin_edge/fit04_final_preview/`；可用 `tools/render-vmd-pose-check.mjs` 对任意 VMD 重新导出截图和指标。
- PMX rest pose 仍使用保守轴向近似，后续需要结合真实渲染截图和骨骼轴向标定继续调优。
- 手指是静态 preset overlay，不是逐帧手指动捕。
- 质量评分用于候选筛选，不等同于最终视觉相似度；最终仍建议通过现有 MMD 渲染链路预览。

## 骨骼轴向渲染校准

主项目已提供 Three.js/MMD VMD 渲染能力，`imgToAction` 通过脚本复用它来生成校准截图：

```powershell
npm --prefix web run dev
node imgToAction/tools/render-axis-calibration.mjs --web-url http://127.0.0.1:3100
```

脚本会读取 `calibration/*/*_schedule.csv`，加载对应校准 VMD，把每个测试的 `target` / `hold` 帧 seek 到精确帧并截图。默认输出：

```text
imgToAction/outputs/axis-calibration-renders/
  manifest.json
  contact-sheet.html
  upper_body/*.png
  lower_body/*.png
  ik_center/*.png
```

打开 `contact-sheet.html` 后，按每张图的 `bone / axis / sign` 观察实际运动方向，再把结果回填到 `schemas/bone_axis_map.template.json` 的副本，例如 `config/bone_axis_map.eula.json`。

常用调试参数：

```powershell
node imgToAction/tools/render-axis-calibration.mjs --groups upper_body --limit 6
node imgToAction/tools/render-axis-calibration.mjs --frames target --render-pipeline genshin
node imgToAction/tools/render-axis-calibration.mjs --model imgToAction/assets/pmx/优菈.pmx --viewport 1024x1536
```

默认模型优先使用主项目 `MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx`，该文件与本包 PMX 哈希一致但带完整贴图目录；如果该路径不存在，会回退到 `imgToAction/assets/pmx/优菈.pmx`。默认 `hero-shot` 管线用于获得深色背景下的清晰轮廓；需要透明背景时可显式传 `--render-pipeline genshin`。
