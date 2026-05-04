# Companion Send Button Reference-Match Spec
**日期：** 2026-05-03

**状态：** 待确认

```yaml
task: companion-send-button-reference-match
goal:
  type: 硬约束
  statement: 将 /companion 底栏发送按钮硬对齐到用户提供的参考图，不接受“接近”或“差不多”，并保持 send_icon_fixed PNG 多倍图路线。
scope:
  target: 发送按钮本体、PNG 可见主体、输入槽右端与按钮的一体化边界、default/hover/disabled/loading 四态资源与切换观感
  frame: 以用户提供的发送按钮参考图为唯一视觉标准；对齐边界包含按钮本体以及按钮所在的输入槽右端区域，不扩展到 TTS、语音模式、高级功能按钮
acceptance:
  - 发送按钮必须保持“输入槽内嵌小按钮”结构，不能回退为独立悬浮主按钮。
  - 发送按钮外层几何、按钮所在右端槽位宽度、按钮在输入槽中的水平与垂直位置，必须按参考图进行定量对齐。
  - 发送按钮的紫色可见主体尺寸必须按参考图对齐，不能只按 PNG 外框或 CSS box 尺寸判断。
  - 必须显式把 PNG 透明留白计入对齐过程，对齐对象是“最终渲染后的可见主体”而不是原始资源边界。
  - 按钮与输入槽右端边界必须保持一体化，不能出现二次嵌套槽体、独立底板、断裂边界或“按钮套按钮”观感。
  - default、hover、disabled、loading 四种状态都必须使用带透明通道的 PNG 多倍图作为最终视觉主体。
  - hover、disabled、loading 各状态必须维持与 default 完全一致的几何、位置和透明边界，只允许状态资源自身的光感与亮度差异。
  - 状态切换动画只允许透明度、亮度、辉光强度等轻量过渡，不允许位移、缩放、弹跳、旋转。
  - 最终验收必须基于真实本地截图与参考图对比，而不是仅依据代码参数或肉眼记忆。
  - 只有当按钮外框、可见主体占比、左右留白、上下留白、右端槽位关系和状态切换观感都对齐后，才算完成。
forbidden:
  - 用 heuristic 微调替代参考图对比与定量反推。
  - 只调整 CSS 外框尺寸而不处理 PNG 可见主体与透明留白。
  - 只让 default 态对齐，忽略 hover、disabled、loading 的视觉一致性。
  - 用纯 CSS 或纯 SVG 替代 send_icon_fixed 系列 PNG 作为最终按钮主体。
  - 在没有本地截图复核的情况下宣布对齐完成。
implementation:
  - 保留 send_icon_fixed 系列 PNG 作为最终按钮主体，并继续使用 1x/2x/3x/4x 多倍图。
  - 先基于参考图和本地截图，对发送按钮区域做定量比对，至少明确：外框宽高、可见主体宽高、透明留白、按钮相对输入槽右端的位置关系。
  - 再反推按钮容器尺寸、图片显示补偿比例、按钮在右端槽位中的定位参数。
  - 对 default、hover、disabled、loading 四态分别验证渲染结果，确保几何与边界不漂移。
  - 完成后必须再次截图，并在结论中明确说明与参考图是否仍有差异以及差异点。
fallback:
  priority: 参考图视觉一致性优先于当前实现参数；若现有 DOM 结构限制对齐度，允许调整发送按钮局部 DOM，但不改变 PNG 主体路线。
confirm:
  required: true
  status: 待用户确认
```

以上为硬约束定义，等待你确认后我再开始实现。
