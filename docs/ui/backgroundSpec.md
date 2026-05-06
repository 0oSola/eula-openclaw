下面这份可以直接作为 `BACKGROUND_SPEC.md` 给 Codex 使用。

````md
# Three.js 动态背景实现规格 Spec

## 1、目标

实现一个适用于 AI 虚拟助手 / MMD 助手工作台的 Web 动态背景。

整体效果：
- 深蓝色幻想科技背景
- 星空、远海、月光/天光氛围
- 中央角色预留位
- 脚下发光魔法阵
- 漂浮粒子 / 花瓣 / 光点
- 背景动，UI 不动
- Three.js 只负责背景，UI 使用 HTML/CSS 覆盖

参考关键词：
- anime sci-fi fantasy
- blue holographic ambience
- calm ocean night
- AI assistant stage
- magical energy platform
- soft bloom
- glassmorphism UI ready

---

## 2、整体图片效果 JSON 描述

```json
{
  "scene_name": "AI_Assistant_Cyber_Fantasy_Background",
  "visual_goal": "A premium anime-style blue cyber-fantasy background for a virtual AI assistant interface, with a calm ocean, starry sky, glowing holographic magic circle, soft particles, and clean empty center space for character rendering.",
  "composition": {
    "aspect_ratio": "16:9",
    "camera_view": "front-facing wide shot",
    "horizon_position": "lower third",
    "center_space": "large empty vertical area for full-body character",
    "left_space": "reserved for speech bubble or assistant message",
    "right_space": "reserved for status cards and task panels",
    "bottom_space": "reserved for input bar and command panel",
    "depth": "sky far layer, ocean mid layer, magic circle foreground layer"
  },
  "color_tone": {
    "global_tone": "deep luminous blue",
    "temperature": "cool",
    "brightness": "medium-high",
    "contrast": "soft cinematic contrast",
    "saturation": "controlled medium saturation",
    "dominant_palette": [
      {
        "name": "deep space blue",
        "hex": "#020816",
        "weight": 35,
        "usage": "top sky and vignette shadows"
      },
      {
        "name": "ocean blue",
        "hex": "#0B2F66",
        "weight": 25,
        "usage": "middle atmosphere and ocean"
      },
      {
        "name": "cyan glow",
        "hex": "#63CFFF",
        "weight": 20,
        "usage": "magic circle, particles, horizon glow"
      },
      {
        "name": "ice blue highlight",
        "hex": "#BFE9FF",
        "weight": 12,
        "usage": "bloom highlights and star shimmer"
      },
      {
        "name": "violet haze",
        "hex": "#7B6DFF",
        "weight": 5,
        "usage": "subtle nebula edge light"
      },
      {
        "name": "soft petal pink",
        "hex": "#FFD7F2",
        "weight": 3,
        "usage": "rare floating petal accent"
      }
    ],
    "gradient": {
      "sky_top": "#020816",
      "sky_middle": "#0B2F66",
      "sky_bottom": "#4FAEFF",
      "ocean_near": "#153B6E",
      "ocean_far": "#5EC8FF",
      "energy_core": "#DDF7FF",
      "energy_outer": "#59BFFF"
    }
  },
  "lighting": {
    "main_light": {
      "type": "diffused magical glow",
      "color": "#78D8FF",
      "intensity": "soft"
    },
    "ambient_light": {
      "color": "#4A8DFF",
      "intensity": "medium"
    },
    "rim_glow": {
      "enabled": true,
      "color": "#AEEBFF",
      "strength": "soft"
    },
    "bloom": {
      "enabled": true,
      "strength": "medium",
      "style": "anime cinematic bloom"
    },
    "vignette": {
      "enabled": true,
      "color": "#020816",
      "opacity": 0.35
    }
  },
  "objects": {
    "sky": {
      "type": "gradient_sky",
      "features": [
        "dense small stars",
        "subtle twinkle",
        "faint nebula haze",
        "thin circular holographic arc lines"
      ]
    },
    "ocean": {
      "type": "calm_reflective_plane",
      "features": [
        "gentle wave motion",
        "cyan reflection",
        "soft horizon glow",
        "low contrast surface"
      ]
    },
    "magic_circle": {
      "type": "holographic_energy_ring",
      "position": "center bottom foreground",
      "features": [
        "multiple concentric rings",
        "thin cyan lines",
        "slow rotation",
        "pulse glow",
        "soft bloom"
      ]
    },
    "particles": {
      "types": [
        "blue white light orbs",
        "tiny star dust",
        "rare pink petals"
      ],
      "motion": "slow floating upward and sideways",
      "density": "medium-low"
    }
  },
  "negative_requirements": [
    "no character",
    "no face",
    "no UI panels rendered inside WebGL",
    "no text",
    "no logo",
    "no watermark",
    "no hard cyberpunk city",
    "no dense foreground objects",
    "no strong red color",
    "no unreadable dark areas"
  ]
}
````

---

## 3、技术方案

推荐技术栈：

```json
{
  "dependencies": {
    "three": "latest stable",
    "@react-three/fiber": "optional",
    "@react-three/drei": "optional",
    "gsap": "optional"
  },
  "three_addons": [
    "EffectComposer",
    "RenderPass",
    "UnrealBloomPass",
    "OutputPass"
  ]
}
```

说明：

* Three.js 使用 `WebGLRenderer` 渲染背景。
* 后处理使用 `EffectComposer` 管理 Pass 链。
* 发光使用 `UnrealBloomPass`，该 Pass 需要配合 renderer tone mapping 使用。Three.js 官方文档也说明 UnrealBloomPass 用于高质量 bloom，并需要开启 tone mapping。 ([Three.js][1])
* `EffectComposer` 用于组织后处理链路，Pass 会按照加入顺序执行。 ([Three.js][2])

---

## 4、DOM 分层结构

```html
<div class="ai-assistant-page">
  <canvas id="three-bg-canvas"></canvas>

  <div class="character-layer">
    <!-- PNG / Live2D / MMD / Spine character here -->
  </div>

  <div class="ui-layer">
    <!-- top bar / side panel / chat bubble / input bar -->
  </div>
</div>
```

CSS 要求：

```css
.ai-assistant-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #020816;
}

#three-bg-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.character-layer {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.ui-layer {
  position: fixed;
  inset: 0;
  z-index: 2;
}
```

---

## 5、Three.js 场景配置 JSON

```json
{
  "renderer": {
    "alpha": true,
    "antialias": true,
    "powerPreference": "high-performance",
    "pixelRatio": {
      "desktop": "Math.min(window.devicePixelRatio, 2)",
      "mobile": "Math.min(window.devicePixelRatio, 1.5)"
    },
    "toneMapping": "ACESFilmicToneMapping",
    "toneMappingExposure": 1.15,
    "outputColorSpace": "SRGBColorSpace",
    "clearColor": "#020816"
  },
  "camera": {
    "type": "PerspectiveCamera",
    "fov": 45,
    "near": 0.1,
    "far": 2000,
    "position": [0, 2.2, 14],
    "lookAt": [0, 1.6, 0],
    "motion": {
      "enabled": true,
      "type": "subtle_float",
      "xAmplitude": 0.08,
      "yAmplitude": 0.05,
      "speed": 0.2
    }
  },
  "postprocessing": {
    "enabled": true,
    "passes": [
      {
        "type": "RenderPass"
      },
      {
        "type": "UnrealBloomPass",
        "strength": 1.15,
        "radius": 0.55,
        "threshold": 0.72
      },
      {
        "type": "OutputPass"
      }
    ]
  },
  "scene": {
    "fog": {
      "enabled": true,
      "color": "#5CAEFF",
      "near": 35,
      "far": 130
    },
    "background": {
      "type": "shader_gradient",
      "topColor": "#020816",
      "middleColor": "#0B2F66",
      "bottomColor": "#4FAEFF"
    }
  },
  "layers": {
    "skyGradient": {
      "enabled": true,
      "z": -120,
      "shader": "vertical_gradient"
    },
    "starField": {
      "enabled": true,
      "count": 2200,
      "area": [180, 90, 80],
      "sizeRange": [0.015, 0.07],
      "color": "#D8F2FF",
      "opacityRange": [0.25, 0.9],
      "twinkle": true,
      "twinkleSpeed": 0.8
    },
    "nebula": {
      "enabled": true,
      "count": 3,
      "colors": ["#2A8BFF", "#7B6DFF", "#63CFFF"],
      "opacity": 0.12,
      "scaleRange": [28, 55],
      "motionSpeed": 0.0015
    },
    "ocean": {
      "enabled": true,
      "type": "large_plane",
      "position": [0, -3.4, -12],
      "rotation": [-1.5708, 0, 0],
      "size": [260, 180],
      "material": {
        "baseColor": "#0B3F73",
        "emissiveColor": "#1D8DFF",
        "emissiveIntensity": 0.25,
        "transparent": true,
        "opacity": 0.72
      },
      "wave": {
        "enabled": true,
        "height": 0.035,
        "frequency": 1.35,
        "speed": 0.28
      }
    },
    "horizonGlow": {
      "enabled": true,
      "type": "transparent_plane",
      "position": [0, -1.4, -40],
      "size": [100, 18],
      "color": "#78D8FF",
      "opacity": 0.28,
      "blurredTexture": true
    },
    "magicCircle": {
      "enabled": true,
      "position": [0, -3.05, 0],
      "rotation": [-1.5708, 0, 0],
      "radius": 4.8,
      "color": "#72D6FF",
      "opacity": 0.85,
      "rotationSpeed": 0.08,
      "pulseSpeed": 1.2,
      "pulseIntensity": 0.08,
      "rings": [
        {
          "radius": 2.4,
          "thickness": 0.018,
          "opacity": 0.9
        },
        {
          "radius": 3.2,
          "thickness": 0.012,
          "opacity": 0.75
        },
        {
          "radius": 4.1,
          "thickness": 0.009,
          "opacity": 0.55
        },
        {
          "radius": 4.8,
          "thickness": 0.006,
          "opacity": 0.35
        }
      ],
      "radialSymbols": {
        "enabled": true,
        "count": 36,
        "style": "short_line_ticks"
      }
    },
    "floatingParticles": {
      "enabled": true,
      "count": 140,
      "types": [
        {
          "name": "light_orb",
          "weight": 75,
          "color": "#DDF7FF",
          "sizeRange": [0.025, 0.09]
        },
        {
          "name": "cyan_dust",
          "weight": 20,
          "color": "#63CFFF",
          "sizeRange": [0.01, 0.035]
        },
        {
          "name": "pink_petal",
          "weight": 5,
          "color": "#FFD7F2",
          "sizeRange": [0.06, 0.16]
        }
      ],
      "area": [18, 10, 8],
      "motion": {
        "floatSpeedRange": [0.05, 0.22],
        "driftRange": [0.15, 0.7],
        "rotationSpeedRange": [0.05, 0.25]
      }
    }
  }
}
```

---

## 6、模块拆分

请 Codex 按以下文件结构实现：

```text
src/
  components/
    AiAssistantBackground/
      index.tsx
      ThreeBackground.ts
      createRenderer.ts
      createCamera.ts
      createPostprocessing.ts
      objects/
        createGradientSky.ts
        createStarField.ts
        createNebula.ts
        createOcean.ts
        createMagicCircle.ts
        createFloatingParticles.ts
      shaders/
        gradientSkyShader.ts
        oceanWaveShader.ts
        magicCircleShader.ts
        particleShader.ts
      types.ts
      background.config.ts
```

---

## 7、实现要求

1、背景必须全屏铺满

* canvas fixed 定位
* resize 时同步更新 renderer、camera、composer

2、UI 不进入 Three.js

* 所有聊天框、状态面板、按钮继续使用 HTML/CSS
* canvas 只做背景氛围

3、角色区域必须预留

* 中央不放高密度粒子
* 魔法阵位于角色脚下
* 不要在中心区域生成遮挡性物体

4、性能要求

* 桌面端目标 60 FPS
* 移动端目标 30-60 FPS
* 移动端粒子数量减半
* 移动端 bloom strength 降低
* 禁用实时阴影
* 不使用高面数模型

5、视觉要求

* 整体保持蓝色、干净、柔和、高级
* 不要做成强赛博朋克城市风
* 不要出现文字、Logo、UI 图标
* 动态效果要轻，不要抢 UI 和角色主体

---

## 8、动画规则

```json
{
  "animation": {
    "cameraFloat": {
      "enabled": true,
      "x": "sin(time * 0.2) * 0.08",
      "y": "cos(time * 0.18) * 0.05"
    },
    "starTwinkle": {
      "enabled": true,
      "formula": "opacity = baseOpacity + sin(time * speed + randomOffset) * 0.18"
    },
    "oceanWave": {
      "enabled": true,
      "formula": "yOffset = sin(position.x * frequency + time * speed) * height"
    },
    "magicCircle": {
      "rotation": "time * 0.08",
      "pulse": "1.0 + sin(time * 1.2) * 0.08"
    },
    "particles": {
      "movement": "slow upward float with slight x/z drift",
      "reset": "when particle leaves upper boundary, respawn near bottom"
    }
  }
}
```

---

## 9、验收标准

完成后应满足：

```text
1、打开页面后，背景呈现深蓝色幻想科技氛围
2、可看到星空轻微闪烁
3、可看到远处海面轻微波动
4、中心底部存在发光魔法阵，并有缓慢旋转/呼吸效果
5、画面中存在少量漂浮光点和花瓣
6、中央区域干净，可以放置全身角色
7、UI 层可以正常覆盖，不被 canvas 遮挡
8、浏览器窗口 resize 后画面比例正常
9、桌面端运行流畅
10、移动端自动降低粒子和 bloom 强度
```

---

## 10、Codex 执行提示

请按以下顺序实现：

```text
1、创建 AiAssistantBackground 组件
2、初始化 Three.js renderer / scene / camera
3、实现渐变天空
4、实现星空粒子
5、实现海面 plane 和轻微波动
6、实现中心魔法阵
7、实现漂浮粒子
8、接入 EffectComposer + UnrealBloomPass
9、处理 resize 和 dispose
10、增加 mobile quality profile
```

最终输出：

* 可运行组件
* 可配置 JSON
* 完整 TypeScript 类型
* 清理资源的 dispose 逻辑
* 简单 Demo 页面

```

::contentReference[oaicite:2]{index=2}
```