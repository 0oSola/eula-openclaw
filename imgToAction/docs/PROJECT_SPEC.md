# PMX/VMD 图片姿势拟合项目 Spec

## 0. 项目目标

构建一个可由 Codex 本地实现和维护的工具链，用于把角色参考图转化为可编辑、可预览、可迭代优化的 MMD VMD 动作。

本项目的目标不是“图片直接 100% 转 VMD”，而是建立一条可验证的工程闭环：

```text
PMX 模型
+ 目标姿势参考图
+ 动作节点 DSL
+ 骨骼轴向校准
↓
动作节点 → PMX 骨骼旋转
↓
生成 VMD
↓
本地渲染 PMX + VMD
↓
渲染图与参考图做姿态对比
↓
优化动作节点 / 骨骼映射
↓
输出最终 VMD
```

当前测试角色为 `优菈.pmx`，参考图为 0/30/60 帧正面与侧面双视图，当前样例动作为 `自然站立 → 优菈式优雅定格姿势`。

---

## 1. 背景与工具选型

### 1.1 Codex 适用性

Codex 适合承担跨文件、可重复运行、需要本地工具链调试的工程任务。官方说明中，Codex 被定位为帮助写、审查和交付代码的 agent；Codex app 也支持多线程、worktree、Git 等开发工作流。

### 1.2 本地渲染路线

建议优先实现两条渲染路线：

#### 路线 A：Blender + mmd_tools

用于高可信度离线验证。`mmd_tools` 支持导入/导出 PMX、VMD、VPD 等 MMD 数据格式。适合做最终校验、截图和离线批处理。

#### 路线 B：Web Renderer / Three.js

用于交互调参 UI。Three.js 生态中存在 MMDLoader / three-mmd-loader 方向，可以加载 PMX/VMD 并在浏览器中做预览。Web 端更适合做姿态调参、关键帧滑块、差异可视化。

### 1.3 姿态识别路线

姿态检测推荐可插拔实现：

- MediaPipe Pose Landmarker：可从图片/视频检测人体关键点，并提供 2D 图像坐标与 3D world landmarks。
- OpenPose：可检测人体、手、脸、脚等关键点，适合需要更完整关键点的场景。
- 人工标注/手动节点 DSL：当图像姿态识别不稳定时，允许用户直接编辑动作节点。

---

## 2. 不追求 100% 自动还原的原因

图片姿势到 VMD 骨骼旋转之间存在不可逆信息缺失：

1. 单张图缺少深度信息。
2. 服装、头发、披风会遮挡关节。
3. 肩膀内旋/外旋、手腕扭转、脚掌接地等仅凭图片难以唯一确定。
4. 同一个可见轮廓可能由多组骨骼旋转组合得到。
5. PMX 骨骼轴、本地旋转方向、IK 设置、物理刚体都会影响最终表现。

因此验收目标应定义为：

```text
目标帧视觉姿势高度接近参考图
关键关节投影误差低
脚底不明显滑动
手臂不明显穿模
动作节点可解释、可手工微调
VMD 可被 MMD / MMM / Blender mmd_tools 加载
```

---

## 3. 输入与输出

### 3.1 输入

```text
assets/pmx/优菈.pmx
assets/reference_images/frame_00_front.png
assets/reference_images/frame_00_side.png
assets/reference_images/frame_30_front.png
assets/reference_images/frame_30_side.png
assets/reference_images/frame_60_front.png
assets/reference_images/frame_60_side.png
calibration/**/*.vmd
calibration/**/*.csv
schemas/example_pose_nodes_eula_signature.json
schemas/bone_axis_map.template.json
```

### 3.2 输出

```text
outputs/vmd/final_motion.vmd
outputs/renders/frame_000.png
outputs/renders/frame_030.png
outputs/renders/frame_060.png
outputs/debug/pose_nodes_resolved.json
outputs/debug/bone_axis_map.resolved.json
outputs/debug/fitting_report.json
```

---

## 4. 核心架构

```text
src/
  pmx/
    parse_pmx.py
    bone_mapper.py
  vmd/
    read_vmd.py
    write_vmd.py
    interpolation.py
  pose_dsl/
    schema.py
    normalize.py
    pose_nodes_to_bones.py
  calibration/
    generate_axis_calibration_vmd.py
    analyze_axis_notes.py
  render/
    blender_render.py
    threejs_renderer/
  vision/
    extract_keypoints.py
    compare_keypoints.py
    silhouette_compare.py
  optimize/
    fit_pose_nodes.py
  cli.py
```

---

## 5. 动作节点 DSL

### 5.1 设计原则

不要让图片直接输出 MMD 的 X/Y/Z 旋转。正确方式是先输出语义动作节点：

```text
raise        抬高手臂
open_side    向身体侧方展开
forward      向身体前方伸出
backward     向身体后方摆
bend         弯曲
twist        扭转
turn_y       左右转向
tilt_z       左右倾斜
lean_x       前后俯仰
step_x       横向移步
step_z       前后移步
toe_out      脚尖外旋
```

这些语义动作节点再通过 `bone_axis_map` 转成 PMX 具体骨骼旋转。

### 5.2 示例

见：

```text
schemas/example_pose_nodes_eula_signature.json
```

---

## 6. 骨骼轴向校准

### 6.1 为什么必须校准

MMD 的骨骼本地轴不能简单假设为世界 X/Y/Z。以 `右腕 / 左腕 / 右ひじ / 左ひじ` 为例：

```text
语义上的“抬手”
不一定等于
VMD 中某个固定 X/Y/Z 旋转
```

如果不校准，会出现：

```text
本来想抬手 → 实际手臂往后藏
本来想向侧方展开 → 实际向身体内收
本来想转头 → 实际低头或歪头
```

### 6.2 校准文件

本包包含：

```text
calibration/upper_body/eula_axis_calibration_upper_body.vmd
calibration/upper_body/eula_axis_calibration_upper_body_schedule.csv
calibration/lower_body/eula_axis_calibration_lower_body_rotation.vmd
calibration/lower_body/eula_axis_calibration_lower_body_rotation_schedule.csv
calibration/ik_center/eula_axis_calibration_ik_center_position.vmd
calibration/ik_center/eula_axis_calibration_ik_center_position_schedule.csv
```

### 6.3 校准方法

1. 在 MMD / MMM / Blender 中加载 `优菈.pmx`。
2. 加载校准 VMD。
3. 根据 CSV 指定帧观察每个骨骼 X+/X-/Y+/Y-/Z+/Z- 的视觉效果。
4. 填写 `schemas/bone_axis_map.template.json`。
5. 保存为 `config/bone_axis_map.eula.json`。

---

## 7. 图片姿态解析

### 7.1 关键点抽取

对每张参考图提取：

```text
head
neck
left_shoulder / right_shoulder
left_elbow / right_elbow
left_wrist / right_wrist
left_hip / right_hip
left_knee / right_knee
left_ankle / right_ankle
left_toe / right_toe
```

正面图负责 X/Y；侧面图负责 Z/Y。最终合成近似 3D 关节点。

### 7.2 参考图一致性检查

必须检测：

1. 正面与侧面角色高度是否一致。
2. 脚底基线是否一致。
3. 关节点是否被遮挡。
4. 正面/侧面是否真的对应同一动作。
5. 相机是否近似正交。

输出：

```text
outputs/debug/reference_image_quality_report.json
```

---

## 8. 动作节点到骨骼转换

### 8.1 语义到骨骼映射

示例：

```text
right_arm.raise
→ 右腕 + 右肩 + 右腕捩

right_arm.elbow_bend
→ 右ひじ

right_arm.wrist_pitch / yaw / roll
→ 右手首 + 右手捩

body.chest.turn_y / tilt_z
→ 上半身 / 上半身2 / 上半身3

legs.left_leg.step_x / step_z
→ 左足ＩＫ / 左足 / 左足首 / 左つま先ＩＫ
```

### 8.2 四元数输出

VMD 骨骼旋转使用 quaternion。实现上可以先使用内部欧拉角语义，再转换为 quaternion，但必须统一旋转顺序并写入测试。

推荐：

```text
内部语义角度单位：degree
内部组合顺序：先局部语义轴映射，再生成 quaternion
输出格式：VMD quaternion x,y,z,w
```

---

## 9. 本地渲染与拟合

### 9.1 渲染输入

```text
PMX 模型
VMD 文件
目标帧列表：[0, 30, 60, 90]
固定相机参数
固定灯光
纯色背景
```

### 9.2 渲染输出

```text
outputs/renders/frame_000_front.png
outputs/renders/frame_030_front.png
outputs/renders/frame_060_front.png
outputs/renders/frame_060_side.png
```

### 9.3 对比指标

渲染图与参考图计算：

```text
2D 关节点误差
肩线角度误差
髋线角度误差
手腕位置误差
脚踝/脚尖位置误差
轮廓 IoU
脚底接地误差
手臂穿模风险
```

---

## 10. 优化循环

### 10.1 基本流程

```text
读取 pose_nodes.json
生成 VMD
渲染目标帧
提取渲染图关键点
与参考图关键点对比
更新 pose_nodes 参数
重复直到误差收敛或达到最大迭代次数
```

### 10.2 优化参数

第一阶段只优化大关节：

```text
center.shift_x / shift_z
pelvis.turn_y / tilt_z
chest.turn_y / tilt_z / lean_x
head.turn_y / chin_up
right_arm.raise / open_side / forward
right_arm.elbow_bend
left_leg.step_x / step_z / toe_out
```

第二阶段再优化：

```text
wrist_pitch / wrist_yaw / wrist_roll
arm_twist
foot_roll
toe_point
```

### 10.3 约束

```text
脚底不离地
支撑脚不滑动
左右膝盖弯曲方向合理
手臂不穿身体
肩膀不塌陷
动作插值平滑
骨骼旋转不超过限制范围
```

---

## 11. Codex 执行路线

### Phase 1：项目初始化

1. 建立 Python 项目结构。
2. 实现 VMD 读写。
3. 实现 PMX 骨骼名称读取。
4. 读取 `优菈.pmx`，输出骨骼树和标准骨骼映射。

验收：

```text
python -m src.cli inspect-pmx assets/pmx/优菈.pmx
python -m src.cli inspect-vmd samples/vmd/eula_stand_to_signature_pose_final.vmd
```

### Phase 2：校准模块

1. 实现 axis calibration VMD 自动生成。
2. 从 CSV / 用户标注生成 `bone_axis_map.eula.json`。
3. 验证语义动作 `raise/open_side/forward` 能正确转换。

验收：

```text
python -m src.cli generate-axis-calibration --pmx assets/pmx/优菈.pmx
python -m src.cli resolve-axis-map --notes calibration/user_axis_notes.json
```

### Phase 3：动作节点 DSL

1. 加载 `pose_nodes.json`。
2. 验证 schema。
3. 转换为 PMX 标准骨骼帧。
4. 写出 VMD。

验收：

```text
python -m src.cli pose-to-vmd \
  --pmx assets/pmx/优菈.pmx \
  --pose schemas/example_pose_nodes_eula_signature.json \
  --axis-map config/bone_axis_map.eula.json \
  --out outputs/vmd/eula_signature.vmd
```

### Phase 4：Blender 渲染

1. 安装 Blender + mmd_tools。
2. 写 Blender Python 批处理脚本。
3. 导入 PMX。
4. 应用 VMD。
5. 渲染指定帧为 PNG。

验收：

```text
blender -b --python scripts/render_blender.py -- \
  --pmx assets/pmx/优菈.pmx \
  --vmd outputs/vmd/eula_signature.vmd \
  --frames 0,30,60,90 \
  --out outputs/renders
```

### Phase 5：图片拟合

1. 提取参考图关键点。
2. 提取渲染图关键点。
3. 计算误差。
4. 自动调整动作节点。
5. 输出拟合报告。

验收：

```text
python -m src.cli fit-pose \
  --pmx assets/pmx/优菈.pmx \
  --reference assets/reference_images \
  --pose schemas/example_pose_nodes_eula_signature.json \
  --axis-map config/bone_axis_map.eula.json \
  --out outputs/fitted
```

---

## 12. 验收标准

### 12.1 文件级验收

- VMD 能被 MMD / MMM 加载。
- VMD 能被 Blender mmd_tools 导入。
- PMX 骨骼名映射完整。
- 关键帧数量正确。
- 输出 VMD 包含 0/30/60/90 帧。

### 12.2 视觉级验收

- 0 帧为自然站立。
- 60 帧明显接近参考图最终姿势。
- 手臂方向正确，不藏到身体后方。
- 重心明确，脚底没有明显滑动。
- 侧面视图中手臂前后方向合理。
- 动作过渡不卡顿、不突然抽搐。

### 12.3 工程级验收

- 所有 CLI 命令可重复运行。
- 所有输入输出路径可配置。
- pose_nodes 可被手动编辑。
- 每次拟合生成 report。
- 关键算法有单元测试。

---

## 13. 已包含文件说明

```text
assets/reference_images/
  frame_00_front.png
  frame_00_side.png
  frame_30_front.png
  frame_30_side.png
  frame_60_front.png
  frame_60_side.png

assets/pmx/
  优菈.pmx

calibration/
  upper_body/
  lower_body/
  ik_center/

samples/vmd/
  eula_stand_to_elegant_pose_test.vmd
  eula_stand_to_elegant_pose_v2.vmd
  eula_stand_to_elegant_pose_v3.vmd
  eula_stand_to_signature_pose_final.vmd

schemas/
  pose_node_schema.json
  example_pose_nodes_eula_signature.json
  bone_axis_map.template.json
```

---

## 14. 参考资料

- OpenAI Codex help: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- OpenAI Codex app docs: https://developers.openai.com/codex/app
- mmd_tools: https://github.com/MMD-Blender/blender_mmd_tools
- three-mmd-loader: https://github.com/hanakla/three-mmd-loader
- MediaPipe Pose Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- OpenPose: https://github.com/cmu-perceptual-computing-lab/openpose
