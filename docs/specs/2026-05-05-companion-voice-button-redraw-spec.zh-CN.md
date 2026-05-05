---
task: companion-voice-button-reference-replacement
date: 2026-05-05
---

# Companion Voice Button Replacement

## Target

将 `/companion` 底栏左侧语音输入按钮替换为用户提供的麦克风按钮资源，并沿用 send 按钮的 PNG 多倍图渲染方案。

## Reference Boundary

只约束语音输入按钮本体，不扩大到 TTS 开关、输入框或底栏整体布局。

## Reconstruction Mode

```yaml
reconstruction_mode:
  target: visual_match
  fallback_allowed: true
feasibility:
  pure_svg:
    risk: high
    blockers:
      - soft glow diffusion
      - smooth purple/blue raster gradients
      - antialiased white glyph edges
  fallback:
    recommended: true
```

## Acceptance Criteria

- 语音按钮使用 `web/images/voice` 下的 PNG 多倍图资源，不再使用 CSS 渐变面板和内联 SVG 作为最终视觉主体。
- 资源路径包含 `1x/2x/3x/4x`，渲染层结构与 send 按钮一致。
- 默认、hover、disabled、loading 四个状态保持相同几何尺寸，仅调整亮度、饱和度、透明度或柔光强度。
- 按钮可点击区域保持在现有 command bar 左侧语音按钮位置内，不挤压 TTS、输入框和右侧控件。
- 可访问名称继续为“语音输入”。

## Forbidden Shortcuts

- 不用纯 CSS 近似重画按钮主体。
- 不用内联 SVG 作为最终麦克风图标主体。
- 不增加额外可见外壳来伪装参考资源。
- 不改变 send 按钮实现路径。

## Stop Condition

代码检查通过，构建通过，并确认 `/companion` 语音按钮实际使用 PNG picture/img 资产栈。
