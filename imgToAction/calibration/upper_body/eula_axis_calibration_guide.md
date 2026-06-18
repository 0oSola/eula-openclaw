# Eula PMX Axis Calibration Guide

目标：确认这个 PMX 中关键骨骼的本地 X/Y/Z 正负方向，后续把动作节点 DSL 稳定转换成 VMD。

## 使用方法
1. 在 MMD / MMM / Blender MMD Tools 中加载 `优菈.pmx`。
2. 先加载 `eula_axis_calibration_upper_body.vmd`。
3. 跳到 CSV 中的 `target_frame` 或 `hold_frame`，观察对应骨骼的运动方向。
4. 记录每个轴向实际效果，例如：`右腕 X+ = 手臂向前`、`右腕 Y- = 手臂向上`、`左ひじ Z+ = 手肘弯曲`。
5. 优先反馈这些骨骼：`右腕 / 左腕 / 右ひじ / 左ひじ / 右肩 / 左肩`。

## 观察模板
```text
右腕 X+：
右腕 X-：
右腕 Y+：
右腕 Y-：
右腕 Z+：
右腕 Z-：

左腕 X+：
左腕 X-：
左腕 Y+：
左腕 Y-：
左腕 Z+：
左腕 Z-：

右ひじ 哪个方向是自然弯曲：
左ひじ 哪个方向是自然弯曲：
```

## 文件说明
- `eula_axis_calibration_upper_body.vmd`：手臂、肩、躯干、头部旋转轴测试。
- `eula_axis_calibration_lower_body_rotation.vmd`：大腿、膝盖、脚踝旋转轴测试。
- `eula_axis_calibration_ik_center_position.vmd`：足 IK、センター、グルーブ 位移方向测试。

每段测试会经历：归零 → 旋转/位移到目标 → 保持 → 归零。
