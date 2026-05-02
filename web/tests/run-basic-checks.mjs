import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BUILT_IN_VMD_PLAYBACK_RATE, DEFAULT_VMD_PLAYBACK_RATE } from "../src/features/stage/builtInMotionPreferences.js";
import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createDefaultFavoriteLoopInteraction,
  resolveVmdPlaybackRate,
} from "../src/features/mapping/vmdPreview.js";
import { collectImportableVmdFiles } from "../src/features/stage/vmdImportHelpers.js";
import { resolveActionConfig, resolvePlaybackPlan } from "../src/features/mapping/resolveAction.js";
import { buildTraceHeaders } from "../src/lib/trace.js";

function run() {
  {
    const commandBarSource = readFileSync(new URL("../src/app/companion/CompanionCommandBar.tsx", import.meta.url), "utf8");
    const companionPageSource = readFileSync(new URL("../src/app/companion/page.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

    assert.match(commandBarSource, /export function CompanionCommandBar/);
    assert.doesNotMatch(commandBarSource, /ttsNotice: string/);
    assert.doesNotMatch(commandBarSource, /className="mio-notice"/);
    assert.match(commandBarSource, /mio-command-shell/);
    assert.match(companionPageSource, /<CompanionCommandBar/);
    assert.match(companionPageSource, /const \[toast, setToast\] = useState/);
    assert.match(companionPageSource, /ignoreNextStageCompletionResetRef = useRef\(false\)/);
    assert.match(companionPageSource, /function handleTtsFailure\(message: string\)/);
    assert.match(companionPageSource, /className="mio-toast-layer"/);
    assert.match(companionPageSource, /className="mio-toast"/);
    assert.doesNotMatch(companionPageSource, /<form className="mio-command-bar"/);
    assert.match(
      companionPageSource,
      /const response = await postChat\([\s\S]*?try\s*\{\s*await speak\(response\.text\);\s*\}\s*catch\s*\(speakError\)/,
    );
    assert.match(companionPageSource, /catch\s*\(err\)\s*\{\s*pushToast\(/);
    assert.doesNotMatch(companionPageSource, /发送失败，请检查 API 服务状态和配置/);
    assert.match(companionPageSource, /if \(ignoreNextStageCompletionResetRef\.current\) \{/);
    assert.match(cssSource, /\.mio-command-shell/);
    assert.match(cssSource, /\.mio-command-surface/);
    assert.match(cssSource, /\.mio-toast-layer/);
    assert.match(cssSource, /\.mio-toast/);
    assert.match(cssSource, /\.mio-layout\s*\{/);
    assert.match(cssSource, /display: flex;/);
    assert.match(cssSource, /padding: var\(--mio-layout-padding-top\) var\(--mio-layout-padding-x\) 0;/);
    assert.match(cssSource, /margin-bottom: var\(--mio-side-panels-bottom-gap\);/);
  }

  {
    const resolved = resolveActionConfig({
      slot: "happy",
      userMappings: {
        happy: { kind: "procedural", value: "cheer" },
      },
      defaultMappings: {
        happy: { kind: "procedural", value: "wave" },
      },
    });
    assert.equal(resolved.kind, "procedural");
    assert.equal(resolved.value, "cheer");
  }

  {
    const resolved = resolvePlaybackPlan({
      slot: "happy",
      action: "wave",
      userMappings: {
        happy: { kind: "vmd", value: "missing-asset-id" },
      },
      defaultMappings: {},
      assetIndex: {},
    });
    assert.equal(resolved.mode, "procedural");
    assert.equal(resolved.action, "wave");
  }

  {
    const resolved = resolvePlaybackPlan({
      slot: "happy",
      action: "wave",
      motionPlan: {
        sequence: [
          { template: "greet_wave", duration_ms: 1200, intensity: 0.8 },
          { template: "listen_lean", duration_ms: 1800, intensity: 0.4 },
        ],
      },
      userMappings: {},
      defaultMappings: {},
      assetIndex: {},
    });
    assert.equal(resolved.mode, "procedural");
    assert.deepEqual(resolved.sequence, [
      { action: "wave", durationMs: 1200, intensity: 0.8, template: "greet_wave" },
      { action: "lean_in", durationMs: 1800, intensity: 0.4, template: "listen_lean" },
    ]);
  }

  {
    assert.equal(DEFAULT_VMD_PLAYBACK_RATE, 1);
    assert.equal(BUILT_IN_VMD_PLAYBACK_RATE, 1.8);
    assert.ok(BUILT_IN_VMD_PLAYBACK_RATE > DEFAULT_VMD_PLAYBACK_RATE);
    assert.equal(resolveVmdPlaybackRate({ filename: "idle_animations_pack/pose.vmd" }), 2.5);
    assert.equal(resolveVmdPlaybackRate({ filename: "idle_animations_pack/pose.vmd" }, 0.8), 2);
    assert.equal(resolveVmdPlaybackRate({ url: "/assets/mmd/vmd/idle_animations_pack/sample.vmd" }), 2.5);
    assert.equal(
      resolveVmdPlaybackRate({
        filename: "Smelling Something in the Air.vmd",
        source_relative_path: "Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd",
      }),
      2.5,
    );
    assert.equal(resolveVmdPlaybackRate({ filename: "wave.vmd" }), DEFAULT_VMD_PLAYBACK_RATE);
    assert.equal(resolveVmdPlaybackRate({ filename: "wave.vmd" }, 1.5), 1.5);
    assert.deepEqual(
      createDefaultFavoriteLoopInteraction([
        {
          asset_id: "asset-standby",
          slot: "neutral",
          filename: "进场待机.vmd",
          display_name: "进场待机.vmd",
          url: "/assets/vmd/file/asset-standby",
        },
        {
          asset_id: "asset-2",
          slot: "sad",
          filename: "lead.vmd",
          display_name: "lead.vmd",
          url: "/assets/vmd/file/asset-2",
        },
        {
          asset_id: "asset-1",
          slot: "happy",
          filename: "follow.vmd",
          display_name: "follow.vmd",
          url: "/assets/vmd/file/asset-1",
        },
      ]),
      {
        emotion: "sad",
        action: "idle",
        mode: "vmd",
        vmdUrl: "/assets/vmd/file/asset-2",
        vmdLoopUrls: ["/assets/vmd/file/asset-2", "/assets/vmd/file/asset-1"],
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
        sequence: [],
      },
    );
    assert.deepEqual(
      buildAutoFavoriteInteraction([
        {
          asset_id: "asset-standby",
          slot: "neutral",
          filename: "杩涘満寰呮満.vmd",
          display_name: "杩涘満寰呮満.vmd",
          url: "/assets/vmd/file/asset-standby",
        },
        {
          asset_id: "asset-2",
          slot: "sad",
          filename: "lead.vmd",
          display_name: "lead.vmd",
          url: "/assets/vmd/file/asset-2",
        },
        {
          asset_id: "asset-1",
          slot: "happy",
          filename: "follow.vmd",
          display_name: "follow.vmd",
          url: "/assets/vmd/file/asset-1",
        },
      ]),
      {
        emotion: "sad",
        action: "idle",
        mode: "vmd",
        vmdUrl: "/assets/vmd/file/asset-2",
        vmdLoopUrls: ["/assets/vmd/file/asset-2", "/assets/vmd/file/asset-1"],
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
        sequence: [],
      },
    );
    assert.deepEqual(
      buildAutoplayResumeInteraction([
        {
          asset_id: "asset-standby",
          slot: "neutral",
          filename: "杩涘満寰呮満.vmd",
          display_name: "杩涘満寰呮満.vmd",
          url: "/assets/vmd/file/asset-standby",
        },
        {
          asset_id: "asset-2",
          slot: "sad",
          filename: "lead.vmd",
          display_name: "lead.vmd",
          url: "/assets/vmd/file/asset-2",
        },
        {
          asset_id: "asset-1",
          slot: "happy",
          filename: "follow.vmd",
          display_name: "follow.vmd",
          url: "/assets/vmd/file/asset-1",
        },
      ]),
      {
        emotion: "sad",
        action: "idle",
        mode: "vmd",
        vmdUrl: "/assets/vmd/file/asset-2",
        vmdLoopUrls: ["/assets/vmd/file/asset-2", "/assets/vmd/file/asset-1"],
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
        sequence: [],
      },
    );
    assert.equal(
      createDefaultFavoriteLoopInteraction([
        {
          asset_id: "asset-standby-only",
          slot: "neutral",
          filename: "杩涘満寰呮満.vmd",
          display_name: "杩涘満寰呮満.vmd",
          url: "/assets/vmd/file/asset-standby-only",
        },
      ]),
      null,
    );
  }

  {
    const files = collectImportableVmdFiles([
      { name: "idle_a.vmd" },
      { name: "README.txt" },
      { name: "pose.VMD" },
      { name: "" },
    ]);
    assert.deepEqual(files.map((file) => file.name), ["idle_a.vmd", "pose.VMD"]);
  }

  {
    const headers = buildTraceHeaders("trace-fixed", "u1");
    assert.equal(headers["x-trace-id"], "trace-fixed");
    assert.equal(headers["x-user-id"], "u1");
  }

  {
    const headers = buildTraceHeaders("", "u2");
    assert.ok(headers["x-trace-id"]);
    assert.equal(headers["x-user-id"], "u2");
  }

  console.log("basic checks passed");
}

run();
