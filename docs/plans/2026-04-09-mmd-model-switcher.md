# MMD 模型动态切换实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `/companion` 页面增加模型选择器，动态列出 `MMD/` 目录下可用的 `.pmx/.pmd` 模型，并支持在运行时切换当前舞台模型，选项名称使用模型文件上一级文件夹名。

**Architecture:** 采用第一个方案，由后端统一负责模型发现和命名规则。`/assets/mmd/models` 在保留现有文件名字段的同时新增 `label` 字段，值取模型文件的直属父目录名。前端在 `/companion` 页面加载模型目录，维护当前选中模型状态，并将所选模型路径与展示名称传给 `MMDStage`；舞台 runtime 复用现有实例，只在模型切换时重新加载 mesh，不重建整页。

**Tech Stack:** FastAPI、Next.js App Router、React 19、TypeScript、Three.js、Playwright、pytest、node:test。

---

### Task 1: 扩展后端模型目录接口

**Files:**
- Modify: `api/app/routes/assets.py`
- Test: `api/tests/test_config_assets_trace_routes.py`

**Step 1: 先写失败测试**

在 `api/tests/test_config_assets_trace_routes.py` 新增或扩展用例，构造如下模型目录：

- `mmd/Nemesis/GirlsFrontline NemesisGnosisDefault.pmx`
- `mmd/Miku/miku_v2.pmd`

断言 `GET /assets/mmd/models` 返回的每个 item 至少包含：

- `name`: 原始文件名
- `label`: 上一级文件夹名
- `relative_path`
- `url`

再补一个边界断言：

- 如果模型文件直接放在 `MMD/` 根目录，没有上一级业务目录，则 `label` 回退为文件名 stem 或文件名

**Step 2: 跑测试，确认先失败**

运行：

```powershell
& 'C:\Users\KSG\AppData\Local\Programs\Python\Python312\python.exe' -m pytest -q api/tests/test_config_assets_trace_routes.py
```

预期：FAIL，原因是当前接口还没有 `label` 字段。

**Step 3: 写最小实现**

在 `api/app/routes/assets.py` 中：

- 增加一个 helper，负责从 `Path` 推导 `label`
- 规则优先使用 `path.parent.name`
- 如果父目录就是根目录或为空，则回退到 `path.stem`
- 在 `_mmd_model_public()` 中增加 `label`
- 保留 `name=path.name`，避免破坏现有兼容性

**Step 4: 重新跑测试，确认通过**

继续运行同一个 pytest 命令，确认新增断言通过。

**Step 5: 提交**

```bash
git add api/app/routes/assets.py api/tests/test_config_assets_trace_routes.py
git commit -m "feat: expose labeled mmd model catalog"
```

### Task 2: 增加前端模型目录类型与 API 调用

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/api.ts`
- Test: `web/tests/run-basic-checks.mjs` 或新增一个 node test 文件

**Step 1: 先写失败测试**

为前端模型目录响应增加一个小型测试，覆盖以下内容：

- 输入 payload 含有 `name`、`label`、`relative_path`、`url`
- API helper 正确返回这些字段
- `label` 被作为展示名保留下来

如果现有 `run-basic-checks` 不适合，新增一个 `node --test` 风格的小测试文件。

**Step 2: 跑测试，确认先失败**

运行：

```powershell
node --test web/tests/<new-test-file>.mjs
```

预期：FAIL，因为 `MmdModelAsset` 或 `listMmdModels()` 还不存在。

**Step 3: 写最小实现**

在 `web/src/lib/types.ts` 中新增：

- `MmdModelAsset`
  - `name`
  - `label`
  - `relative_path`
  - `size_bytes`
  - `url`

在 `web/src/lib/api.ts` 中新增：

- `listMmdModels(): Promise<MmdModelAsset[]>`
- 复用已有 `requestJSON`
- 返回 `payload.items || []`

**Step 4: 重新跑测试，确认通过**

运行新增 node test，再运行：

```powershell
npm run check:basic
```

**Step 5: 提交**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/tests/
git commit -m "feat: add frontend mmd model catalog client"
```

### Task 3: 在 `/companion` 页面加入模型选择状态

**Files:**
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/src/features/stage/MMDStage.tsx`
- Test: `web/tests/e2e/mmd-stage-debug.spec.ts`

**Step 1: 先写失败测试**

扩展 Playwright 用例，验证：

- 页面存在模型选择器
- 选择器选项来自 `/assets/mmd/models`
- 选项主文本使用 `label`，即父目录名
- 页面首次渲染后舞台仍能正常加载

**Step 2: 跑测试，确认先失败**

运行：

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3130'; & 'C:\nvm4w\nodejs\npx.cmd' playwright test tests/e2e/mmd-stage-debug.spec.ts --config=playwright.config.ts --reporter=list
```

预期：FAIL，因为当前页面还没有模型选择器。

**Step 3: 写最小实现**

在 `web/src/app/companion/page.tsx` 中：

- 与 `getResolvedMappings()`、`listVmdAssets()` 一起加载 `listMmdModels()`
- 增加状态：
  - `models`
  - `selectedModelPath`
  - `selectedModelLabel`
- 默认选择策略：
  - 如果目录中包含当前 Nemesis 默认路径，优先选它
  - 否则选择返回列表中的第一个模型
- 页面中增加 `<select>` 或等价控件
- 选项文本用 `label`
- 变更选择时只更新当前模型状态，不影响聊天状态

在 `web/src/features/stage/MMDStage.tsx` 中：

- 移除硬编码的 `DEFAULT_MODEL_PATH`
- 改为接收 `modelPath`、`modelLabel`
- 用 `modelPath` 生成最终 `modelUrl`
- 舞台标题下的模型说明文本显示 `modelLabel`

**Step 4: 重新跑测试，确认通过**

重新运行 Playwright 测试，确认：

- 选择器可见
- 模型名称显示为父目录名
- 画布正常加载

**Step 5: 提交**

```bash
git add web/src/app/companion/page.tsx web/src/features/stage/MMDStage.tsx web/tests/e2e/mmd-stage-debug.spec.ts
git commit -m "feat: add mmd model selector to companion page"
```

### Task 4: 让舞台 runtime 支持模型热切换

**Files:**
- Modify: `web/src/features/stage/MMDStage.tsx`
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: 先写失败测试**

在 `web/tests/mmd-render-runtime.test.mjs` 中增加模型切换相关测试：

- 当 `modelUrl` 变化时，会触发新的 `loadModel`
- 切换模型时旧模型会先 `clearModel`
- 不要求整页重建，也不要求 runtime 实例销毁重建

**Step 2: 跑测试，确认先失败**

运行：

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

预期：FAIL，因为当前 `MMDStage` 的生命周期默认按“初始化一次模型”设计。

**Step 3: 写最小实现**

推荐实现方式：

- `MMDStage` 首次挂载时：`runtime.init(modelUrl)`
- 之后仅监听 `modelUrl` 变化：
  - runtime 已存在时，直接调用 `runtime.loadModel(modelUrl)`
- 保持 `interaction` 和 `speaking` 逻辑不变
- 不重建灯光、相机、controls，只替换模型 mesh

必要保护：

- runtime 未初始化时不要调用 `loadModel`
- 如果连续切换，状态文字要能正确显示 “Loading / Ready / Failed”

**Step 4: 重新跑测试，确认通过**

运行：

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

然后再跑一次 Playwright 舞台测试。

**Step 5: 提交**

```bash
git add web/src/features/stage/MMDStage.tsx web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: support switching stage model at runtime"
```

### Task 5: 做好空目录、异常和回退体验

**Files:**
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/src/app/globals.css`（如需）
- Test: `web/tests/e2e/mmd-stage-debug.spec.ts`

**Step 1: 先写失败测试**

增加 UX 相关断言：

- 没有可用模型时，选择器禁用或显示空状态
- 模型目录接口加载失败时，页面展示明确错误
- 当前选中的模型如果从目录中消失，页面会自动回退到第一项

**Step 2: 跑测试，确认先失败**

运行 Playwright 测试。

**Step 3: 写最小实现**

推荐 UX 规则：

- 选择器主文案只显示 `label`
- 如需附加信息，可用较弱样式显示文件名，但不要替代主名称
- 若模型目录为空：
  - 保持舞台容器在位
  - 显示 “No MMD models found” 或中文等价提示
- 若当前模型失效：
  - 自动切到首个可用模型
  - 在页面上给出一条轻量 warning

**Step 4: 重新跑测试，确认通过**

运行：

```powershell
npm run check:basic
npm run build
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3130'; & 'C:\nvm4w\nodejs\npx.cmd' playwright test tests/e2e/mmd-stage-debug.spec.ts --config=playwright.config.ts --reporter=list
```

**Step 5: 提交**

```bash
git add web/src/app/companion/page.tsx web/src/app/globals.css web/tests/e2e/mmd-stage-debug.spec.ts
git commit -m "feat: polish mmd model selector ux"
```

### Task 6: 完整验证

**Files:**
- Verify: `api/tests/test_config_assets_trace_routes.py`
- Verify: `web/tests/mmd-render-runtime.test.mjs`
- Verify: `web/tests/e2e/mmd-stage-debug.spec.ts`

**Step 1: 跑 API 测试**

```powershell
& 'C:\Users\KSG\AppData\Local\Programs\Python\Python312\python.exe' -m pytest -q api/tests/test_config_assets_trace_routes.py
```

**Step 2: 跑前端 node/runtime 测试**

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npm run check:basic
```

**Step 3: 跑构建**

```powershell
cd web
npm run build
```

**Step 4: 跑 E2E**

```powershell
powershell -File scripts/dev-stack.ps1 -Action start -ApiPort 8130 -WebPort 3130
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3130'; & 'C:\nvm4w\nodejs\npx.cmd' playwright test tests/e2e/mmd-stage-debug.spec.ts --config=playwright.config.ts --reporter=list
```

**Step 5: 最终提交**

```bash
git add api web docs/plans/2026-04-09-mmd-model-switcher.md
git commit -m "feat: support dynamic switching between local mmd models"
```
