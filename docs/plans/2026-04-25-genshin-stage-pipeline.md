# Genshin-Style Stage Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在保留当前 `classic` 舞台渲染效果的前提下，为 `/companion` 的 MMD 舞台新增一套可切换的 `genshin` 风格渲染管线。

**Architecture:** 采用“双管线并存”方案，将当前舞台表现层拆成可配置的 rendering pipeline。角色动作、口型、骨骼驱动、模型加载、VMD 播放继续共用同一套 runtime 逻辑；只有相机预设、灯光、材质 patch、描边、背景和后期作为可切换的表现层分支。`classic` 保持当前视觉与回归基线，`genshin` 作为新增增强路径，允许随时切回旧效果。

**Tech Stack:** Next.js App Router、React 19、Three.js、three-stdlib、node:test、Playwright

---

### Task 1: 为舞台渲染引入显式 pipeline 配置

**Files:**
- Modify: `web/src/features/stage/MMDStage.tsx`
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

在 `web/tests/mmd-render-runtime.test.mjs` 新增配置层测试，覆盖以下断言：

- `getStagePresentationConfig("classic")` 返回当前默认参数：
  - `camera.fov === 36`
  - `background === null`
  - `shadowMapType === THREE.PCFShadowMap`
- `getStagePresentationConfig("genshin")` 返回一组不同于 `classic` 的 preset
- 传入未知 pipeline 时回退到 `classic`

建议新增断言结构：

```javascript
test("stage presentation config supports classic and genshin pipelines", () => {
  const classic = getStagePresentationConfig("classic");
  const genshin = getStagePresentationConfig("genshin");

  assert.equal(classic.camera.fov, 36);
  assert.notDeepEqual(genshin.camera.position, classic.camera.position);
  assert.equal(getStagePresentationConfig("unknown").camera.fov, classic.camera.fov);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL，因为当前 `getStagePresentationConfig()` 还不接受 pipeline 参数，也没有 `genshin` 分支。

**Step 3: Write minimal implementation**

在 `web/src/features/stage/mmdCompanionRuntime.js` 中：

- 将 `getStagePresentationConfig()` 改为 `getStagePresentationConfig(pipeline = "classic")`
- 先内联维护两个 preset：
  - `classic`: 保持当前配置不变
  - `genshin`: 先提供差异化 camera / lights / floor / backdrop / postfx 基础字段
- 未识别的值统一回退到 `classic`

在 `web/src/features/stage/MMDStage.tsx` 中：

- 为 `MMDStage` 新增可选 props：`renderPipeline?: "classic" | "genshin"`
- 默认值为 `"classic"`
- 在构造 `MMDCompanionRuntime` 时传入 `renderPipeline`

在 runtime 构造函数中保存 `this.renderPipeline`

**Step 4: Run test to verify it passes**

Run the same `node --test` command and confirm the new config assertions pass while existing runtime tests remain green.

**Step 5: Commit**

```bash
git add web/src/features/stage/MMDStage.tsx web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add switchable stage pipeline presets"
```

### Task 2: 将 runtime 拆成“共用逻辑 + 可切换表现层”

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

新增 runtime 结构测试，断言初始化时会根据 pipeline 调用不同的 setup 分支，但动作和模型层不分叉。可以通过 stub 方法做轻量测试：

```javascript
test("runtime chooses classic or genshin visual setup without forking shared motion logic", async () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    setupClassicPipeline() { calls.push("classic"); },
    setupGenshinPipeline() { calls.push("genshin"); },
    bindResize() {},
    startRenderLoop() {},
    loadModel: async () => {},
  });

  await runtime.init("/fake-model.pmx");

  assert.deepEqual(calls, ["genshin"]);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL，因为当前 `init()` 和 `setupScene()` 还是单一路径。

**Step 3: Write minimal implementation**

在 `web/src/features/stage/mmdCompanionRuntime.js` 中重构：

- 将当前 `setupScene()` 拆成：
  - `setupScene()`
  - `setupRenderer(presentation)`
  - `setupCamera(presentation)`
  - `setupLights(presentation)`
  - `setupFloor(presentation)`
  - `setupBackdrop(presentation)`
  - `setupClassicPipeline(presentation)`
  - `setupGenshinPipeline(presentation)`
- `init()` 中根据 `this.renderPipeline` 选择 visual setup 分支
- 保持以下方法继续共用，不允许复制两份：
  - `loadModel()`
  - `captureBones()`
  - `playVmd()`
  - `applyInteraction()`
  - `updateBonePose()`
  - `updateMorph()`

关键要求：

- `classic` 路径应尽量复用当前已有实现，确保视觉回归风险最低
- `genshin` 路径只在表现层注入差异，不改动作驱动逻辑

**Step 4: Run test to verify it passes**

再次运行 `node --test web/tests/mmd-render-runtime.test.mjs`，确认新结构测试通过且旧测试未回归。

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "refactor: split stage runtime into shared logic and visual pipelines"
```

### Task 3: 为 classic 和 genshin 分别建立材质 patch 入口

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Optional Create: `web/src/features/stage/materialProfiles.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

新增材质分支测试，要求：

- `classic` 保留当前材质调校行为
- `genshin` 对同一材质应用不同的 toon / specular / emissive / side 策略

示例断言：

```javascript
test("genshin material tuning differs from classic while preserving cutout safety", () => {
  const classic = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7 });
  const genshin = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7 });

  tuneClassicMMDMaterial(classic, {});
  tuneGenshinMMDMaterial(genshin, {});

  assert.equal(classic.alphaTest >= 0.5, true);
  assert.equal(genshin.alphaTest >= 0.5, true);
  assert.notEqual(genshin.emissiveIntensity, classic.emissiveIntensity);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL，因为当前只有一个 `tuneMMDMaterial()`。

**Step 3: Write minimal implementation**

实现方式二选一，推荐第二种：

1. 直接在 `mmdCompanionRuntime.js` 内新增：
   - `tuneClassicMMDMaterial()`
   - `tuneGenshinMMDMaterial()`
2. 或拆出到 `materialProfiles.js`，再由 runtime 引入

实现约束：

- `tuneClassicMMDMaterial()` 逻辑应尽量保持当前行为不变
- `tuneGenshinMMDMaterial()` 新增：
  - 更硬的 ramp 注入
  - profile 分型：`face` / `skin` / `hair` / `cloth` / `metal` / `default`
  - 暖主光、冷辅光前提下更稳定的阴影阈值
  - 面部更弱自阴影
  - 头发和薄布料继续保留 `alphaTest` 与 `DoubleSide` 安全策略

然后在 `loadModel()` 中按 `this.renderPipeline` 选择对应 patch 方法。

**Step 4: Run test to verify it passes**

继续运行同一条 `node --test` 命令，确认 classic 既有行为保住，genshin 新行为可测。

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/src/features/stage/materialProfiles.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add per-pipeline mmd material tuning"
```

### Task 4: 为 genshin 管线增加角色描边，但不影响 classic

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Optional Create: `web/src/features/stage/outlineHelpers.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

添加轻量装配测试：

- `classic` pipeline 下不会创建 outline 资源
- `genshin` pipeline 下在模型加载后会附加 outline

示例：

```javascript
test("genshin pipeline attaches character outline while classic does not", async () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    attachCharacterOutline() { calls.push("outline"); },
  });

  runtime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [makeMaterial()] }));
    },
  };

  await runtime.loadModel("/fake-model.pmx");

  assert.deepEqual(calls, ["outline"]);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL，因为当前 `loadModel()` 没有 outline 分支。

**Step 3: Write minimal implementation**

在 runtime 中新增：

- `attachCharacterOutline(mesh, presentation)`
- `disposeCharacterOutline()`

实现要求：

- 仅在 `genshin` pipeline 启用
- 首版优先使用几何外扩描边，不要先依赖 `OutlinePass`
- outline 资源需要在 `clearModel()` / `dispose()` 中一起销毁
- 线色不要纯黑，使用偏蓝灰的柔和颜色
- 保证 `classic` 路径完全不受影响

**Step 4: Run test to verify it passes**

重新运行 `node --test web/tests/mmd-render-runtime.test.mjs`，确认 outline 分支仅在 `genshin` 激活。

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/src/features/stage/outlineHelpers.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add genshin-only character outline layer"
```

### Task 5: 为 genshin 管线加入背景、光晕和舞台空间层

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Optional Create: `web/src/features/stage/stagePresets.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

新增 preset / scene 装配测试，覆盖：

- `classic.background === null`
- `genshin` preset 拥有 backdrop 配置
- `setupBackdrop()` 在 `genshin` 下会向 scene 添加背景元素

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL，因为当前 scene 不存在独立 backdrop 层。

**Step 3: Write minimal implementation**

在 `genshin` preset 中定义：

- 渐变背景色或背景卡片
- 背后 halo 光板
- 微弱雾效或深度衰减参数
- 比 `classic` 更有展示感的 floor 参数

在 runtime 中实现 `setupBackdrop(presentation)`：

- `classic` 直接跳过
- `genshin` 添加最少量必要节点：
  - 一个背景平面或大半球
  - 一个角色背后发光 card
  - 可选一层轻量粒子或装饰 geometry

保持范围克制，不引入完整大场景资源。

**Step 4: Run test to verify it passes**

运行同一条 `node --test` 命令，确认 `classic` 仍为空背景，`genshin` 新增 backdrop 装配通过。

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/src/features/stage/stagePresets.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add genshin stage backdrop layer"
```

### Task 6: 为 genshin 管线引入可控后期，但保持 classic 直出

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Optional Create: `web/src/features/stage/postfx/colorGradePass.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

新增后期装配测试：

- `classic` pipeline 使用 `renderer.render(scene, camera)`
- `genshin` pipeline 使用 composer 渲染路径
- `genshin` 的 postfx 配置至少包含 `colorGrade` 与 `bloom`

示例：

```javascript
test("classic renders directly while genshin uses postfx composer", () => {
  const classic = makeRuntime({ renderPipeline: "classic" });
  const genshin = makeRuntime({ renderPipeline: "genshin" });

  assert.equal(classic.shouldUsePostFX(), false);
  assert.equal(genshin.shouldUsePostFX(), true);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL，因为当前没有 composer / postfx 分支。

**Step 3: Write minimal implementation**

在 runtime 中新增：

- `setupPostprocessing(presentation)`
- `shouldUsePostFX()`
- `renderScene()`

实现要求：

- `classic`：
  - 继续使用当前直接渲染
  - 不改变现有输出风格
- `genshin`：
  - 使用 `EffectComposer`
  - 第一版只接入：
    - `RenderPass`
    - 自定义 `ColorGradePass` 或等价 `ShaderPass`
    - 轻量 bloom
- `renderFrame()` 改为统一调用 `renderScene()`

避免一开始引入太多 pass，先保证可控和可回退。

**Step 4: Run test to verify it passes**

重新运行 `node --test web/tests/mmd-render-runtime.test.mjs`，确认 classic / genshin 两条渲染路径分流正常。

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/src/features/stage/postfx/colorGradePass.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add genshin postfx pipeline"
```

### Task 7: 提供 UI 切换入口并持久化当前选择

**Files:**
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/src/features/stage/MMDStage.tsx`
- Modify: `web/src/lib/session.ts`
- Test: `web/tests/e2e/app-routes-smoke.spec.ts`

**Step 1: Write the failing test**

在 `web/tests/e2e/app-routes-smoke.spec.ts` 新增 smoke 场景：

- `/companion` 初始可见舞台
- 页面存在渲染风格切换控件
- 从 `classic` 切到 `genshin` 后舞台仍存在
- 切回 `classic` 后舞台仍存在
- 刷新后保持上次选择

如果当前 e2e 不方便验证真实像素差异，先验证：

- 控件存在
- 切换动作不导致 runtime 崩溃
- 本地存储状态被更新

**Step 2: Run test to verify it fails**

Run:

```powershell
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
```

Expected: FAIL，因为当前页面没有 pipeline 切换入口。

**Step 3: Write minimal implementation**

在 `/companion` 页面中：

- 增加 `renderPipeline` state，默认值为 `"classic"`
- 增加简洁的 UI 控件：
  - segmented control 或 select
  - 文案建议：`Classic` / `Genshin`
- 将 `renderPipeline` 透传给 `MMDStage`
- 在 `session.ts` 中增加持久化字段，保存当前渲染风格

要求：

- 默认仍为 `classic`
- 不改变当前页面主要布局结构
- 切换时允许重建 visual pipeline，但不应破坏页面其余交互

**Step 4: Run test to verify it passes**

重新运行同一条 Playwright 命令，确认切换与持久化 smoke test 通过。

**Step 5: Commit**

```bash
git add web/src/app/companion/page.tsx web/src/features/stage/MMDStage.tsx web/src/lib/session.ts web/tests/e2e/app-routes-smoke.spec.ts
git commit -m "feat: add companion stage render pipeline switcher"
```

### Task 8: 补齐回归验证，确保 classic 视觉和行为保持基线

**Files:**
- Modify: `web/tests/mmd-render-runtime.test.mjs`
- Modify: `web/tests/e2e/mmd-stage-debug.spec.ts`
- Optional Update: `README.md`

**Step 1: Write the failing test**

补一组回归断言，要求：

- `classic` 的 config 仍等于旧值
- `classic` 加载模型、口型、动作、VMD 回放测试继续通过
- `genshin` 开启后不会影响模型切换、说话状态、舞台尺寸 smoke test

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected: 若任何 classic 行为在重构后发生偏移，应先暴露为 FAIL。

**Step 3: Write minimal implementation**

根据失败情况只做最小修正：

- 修正 `classic` preset 偏移
- 修正切换时未释放的 outline / composer / backdrop 资源
- 修正 session 持久化字段读取
- 必要时在 `README.md` 或相关文档中补一段渲染风格说明

不要在这一任务再追加新视觉特性；这里只做回归收口。

**Step 4: Run test to verify it passes**

完整运行：

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected:

- 所有 node runtime tests PASS
- `classic` 和 `genshin` 都能正常加载舞台
- 切换 pipeline 不导致舞台丢失或报错

**Step 5: Commit**

```bash
git add web/tests/mmd-render-runtime.test.mjs web/tests/e2e/app-routes-smoke.spec.ts web/tests/e2e/mmd-stage-debug.spec.ts README.md
git commit -m "test: lock in classic baseline and genshin pipeline switch"
```
