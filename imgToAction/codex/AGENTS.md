# AGENTS.md — Codex Implementation Guide

## 角色

你是本项目的本地工程实现 agent。你的任务是把现有 PMX/VMD 测试资产，发展为一个可重复运行的图片姿势拟合 VMD 生成器。

## 最重要的原则

1. 不要直接从图片生成 VMD。
2. 必须经过中间层：`图片关键点 → 动作节点 DSL → PMX 骨骼旋转 → VMD`。
3. MMD 骨骼本地轴不能猜，必须通过校准 VMD 和用户反馈生成 `bone_axis_map`。
4. 每次生成 VMD 后都要本地渲染并输出截图。
5. 所有调参都要回写到 JSON，不要只改代码里的 magic number。
6. 输出必须可被 MMD / MMM / Blender mmd_tools 加载。

## 第一阶段任务

- 实现 `inspect-pmx`
- 实现 `inspect-vmd`
- 实现 `write-vmd`
- 读取 `schemas/example_pose_nodes_eula_signature.json`
- 使用 `schemas/bone_axis_map.template.json` 的映射结构输出测试 VMD

## 第二阶段任务

- 实现 Blender 批渲染脚本
- 固定相机、正交视角、纯色背景
- 渲染 frame 0/30/60/90
- 输出到 `outputs/renders/`

## 第三阶段任务

- 接入 MediaPipe/OpenPose 任一关键点检测器
- 对参考图和渲染图提取关键点
- 输出误差报告
- 自动优化动作节点参数

## CLI 建议

```bash
python -m src.cli inspect-pmx assets/pmx/优菈.pmx
python -m src.cli pose-to-vmd --pose schemas/example_pose_nodes_eula_signature.json --out outputs/vmd/eula_signature.vmd
python -m src.cli render --pmx assets/pmx/优菈.pmx --vmd outputs/vmd/eula_signature.vmd --frames 0,30,60,90
python -m src.cli fit-pose --reference assets/reference_images --pose schemas/example_pose_nodes_eula_signature.json
```

## 完成定义

- VMD 能加载。
- 60 帧渲染图与 `frame_60_front.png` / `frame_60_side.png` 姿势高度接近。
- 生成 `outputs/debug/fitting_report.json`。
- 所有中间动作节点可编辑。
