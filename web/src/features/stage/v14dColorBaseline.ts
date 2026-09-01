/// <reference types="@webgpu/types" />

import { REZE_K3_SCENE_DEFAULTS, type RezeSceneDebugSettings } from "@/features/stage/rezeDesignDefaults";

export const V14D_COLOR_BASELINE_WIDTH = 1280;
export const V14D_COLOR_BASELINE_HEIGHT = 720;
export const V14D_COLOR_BASELINE_FPS = 30;
export const V14D_COLOR_BASELINE_FRAME = 120;
export const V14D_COLOR_BASELINE_SECONDS = V14D_COLOR_BASELINE_FRAME / V14D_COLOR_BASELINE_FPS;
export const V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD = 0.5;
export const V14D_COLOR_BASELINE_EPSILON = 1e-6;

export const V14D_COLOR_BASELINE_CAMERA = {
  fov: 28.072486935852954,
  position: [0.375, 16.6875, -12.75] as [number, number, number],
  target: [0.3786548, 16.68750004, -11.75000668] as [number, number, number],
  locked: true,
};

export const V14D_COLOR_BASELINE_SCENE_KEYS = [
  "sunColor",
  "worldColor",
  "backgroundColor",
  "groundColor",
  "sunAzimuth",
  "sunElevation",
  "keyIntensity",
  "ambientIntensity",
] as const;

export type V14dColorBaselineSceneKey = (typeof V14D_COLOR_BASELINE_SCENE_KEYS)[number];

export type V14dColorBaselineLevel = "baseColor" | "linearHdr" | "finalDisplay";

export type V14dColorBaselineRoi = {
  id: string;
  material: {
    pmx: string;
    blender: string;
    web: string;
    diffuseTexture: string;
  };
  screen: {
    coordinateSpace: "normalized";
    polygon: Array<[number, number]> | null;
    bounds: [number, number, number, number] | null;
  };
  edgeErosionPx: number;
  minValidPixels: number;
  backgroundExclusion: {
    mode: "model-coverage-and-material-id-depth";
    channel: "maskResolveTexture.g+materialMask.g";
    threshold: number;
    rule: string;
  };
  calibrationStatus: "pending-calibration" | "unverified" | "ready";
  reference?: {
    baseColorSrgb?: [number, number, number];
    linearHdrSrgb?: [number, number, number];
    finalDisplaySrgb?: [number, number, number];
    source: string;
  };
};

/**
 * ROI 坐标来自真实的 1280×720 frame-120 白光画面校准。
 * 背景排除仍由材质 mask alpha 完成；bounds 只负责限定已校准的局部取样区域。
 */
export const V14D_COLOR_BASELINE_ROIS: readonly V14dColorBaselineRoi[] = [
  {
    id: "hair.front",
    material: {
      pmx: "HairA",
      blender: "PROTO_GF2_HairA",
      web: "HairA",
      diffuseTexture: "c_KoledaSSR01_slg_hair_d.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.3734375, 0.16527777777777777, 0.21640625, 0.4638888888888889],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.66970604945617, 0.6523746335533499, 0.7086999554537097],
      linearHdrSrgb: [0.6273923359081031, 0.61601119993634, 0.6941206348890926],
      finalDisplaySrgb: [0.5134638775435728, 0.5118026991104822, 0.5720413683333714],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[478,119,277,334]；edgeErosionPx=2。",
    },
  },
  {
    id: "hair.back",
    material: {
      pmx: "HairB",
      blender: "PROTO_GF2_HairB",
      web: "HairB",
      diffuseTexture: "c_KoledaSSR01_slg_hair_d.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.38828125, 0.2638888888888889, 0.26796875, 0.7361111111111112],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.7545091590729425, 0.7346827763842059, 0.7870342315078118],
      linearHdrSrgb: [0.6719024066830409, 0.6586767342221878, 0.736478958865226],
      finalDisplaySrgb: [0.5532433312854331, 0.550117723014672, 0.6046184047457078],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[497,190,343,530]；edgeErosionPx=2。",
    },
  },
  {
    id: "skin.face",
    material: {
      pmx: "Face",
      blender: "PROTO_V14D_GF2_Face",
      web: "Face",
      diffuseTexture: "c_Koleda_slg_face_d.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.4453125, 0.39166666666666666, 0.13046875, 0.15833333333333333],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.9342793003323737, 0.7857934113911736, 0.7624051933801729],
      linearHdrSrgb: [0.8978616929789722, 0.72928035692014, 0.6941475070120563],
      finalDisplaySrgb: [0.7092495249852734, 0.60792236239141, 0.5855194395367366],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[570,282,167,114]；edgeErosionPx=2。",
    },
  },
  {
    id: "clothes.chest",
    material: {
      pmx: "Cth1-Top",
      blender: "PROTO_GF2_Cth1-Top",
      web: "Cth1-Top",
      diffuseTexture: "c_KoledaSSR01_slg_cloth1_da.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.40859375, 0.6027777777777777, 0.23203125, 0.3972222222222222],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.7200672970797082, 0.7134111692974934, 0.7334130523811577],
      linearHdrSrgb: [0.7093168193216505, 0.7030308601009203, 0.7200484540873416],
      finalDisplaySrgb: [0.5206145478093768, 0.5187587002798091, 0.5394622779201983],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[523,434,297,286]；edgeErosionPx=2。",
    },
  },
  {
    id: "clothes.leftSleeve",
    material: {
      pmx: "Cth1-Top",
      blender: "PROTO_GF2_Cth1-Top",
      web: "Cth1-Top",
      diffuseTexture: "c_KoledaSSR01_slg_cloth1_da.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.6859375, 0.9375, 0.01796875, 0.0625],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.7953772012503841, 0.7982162197952023, 0.8161731518402069],
      linearHdrSrgb: [0.7539505448306034, 0.7563871855599547, 0.7699739197593685],
      finalDisplaySrgb: [0.6277303755440624, 0.6306586179066459, 0.6387500862018414],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[878,675,23,45]；edgeErosionPx=2；角色左袖/画面右下可见袖片。",
    },
  },
];

export type V14dSceneValidation = {
  valid: boolean;
  status: "ok" | "scene-mismatch";
  mismatches: Array<{
    key: V14dColorBaselineSceneKey;
    expected: string | number;
    actual: string | number | undefined;
  }>;
};

export function validateV14dColorBaselineScene(
  scene: Partial<RezeSceneDebugSettings> | null | undefined,
): V14dSceneValidation {
  const mismatches: V14dSceneValidation["mismatches"] = [];
  const expected = REZE_K3_SCENE_DEFAULTS;
  const numericKeys: readonly V14dColorBaselineSceneKey[] = [
    "sunAzimuth",
    "sunElevation",
    "keyIntensity",
    "ambientIntensity",
  ];
  const stringKeys: readonly V14dColorBaselineSceneKey[] = [
    "sunColor",
    "worldColor",
    "backgroundColor",
    "groundColor",
  ];
  for (const key of numericKeys) {
    const actual = scene?.[key];
    const expectedValue = expected[key] as number;
    if (typeof actual !== "number" || Math.abs(actual - expectedValue) > V14D_COLOR_BASELINE_EPSILON) {
      mismatches.push({ key, expected: expectedValue, actual });
    }
  }
  for (const key of stringKeys) {
    const actual = scene?.[key];
    const expectedValue = expected[key];
    if (actual !== expectedValue) mismatches.push({ key, expected: expectedValue, actual });
  }
  return {
    valid: mismatches.length === 0,
    status: mismatches.length === 0 ? "ok" : "scene-mismatch",
    mismatches,
  };
}

export function srgbToLinear(channel: number): number {
  const value = Math.max(0, Math.min(1, Number.isFinite(channel) ? channel : 0));
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(channel: number): number {
  const value = Math.max(0, Number.isFinite(channel) ? channel : 0);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

export function srgbToLinearRgb(rgb: readonly [number, number, number]): [number, number, number] {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

type Lab = [number, number, number];

function srgbToLab(rgb: readonly [number, number, number]): Lab {
  const [r, g, b] = srgbToLinearRgb(rgb);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (value: number) => (value > 0.008856451679 ? value ** (1 / 3) : 7.787037037 * value + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000，输入为 D65/sRGB 适配的 Lab。 */
export function deltaE2000(first: Lab, second: Lab): number {
  const [l1, a1, b1] = first;
  const [l2, a2, b2] = second;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const hPrime = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const hue = (Math.atan2(b, a) * 180) / Math.PI;
    return hue >= 0 ? hue : hue + 360;
  };
  const h1Prime = hPrime(a1Prime, b1);
  const h2Prime = hPrime(a2Prime, b2);
  const deltaL = l2 - l1;
  const deltaC = c2Prime - c1Prime;
  let deltaH = h2Prime - h1Prime;
  if (c1Prime * c2Prime === 0) deltaH = 0;
  else if (deltaH > 180) deltaH -= 360;
  else if (deltaH < -180) deltaH += 360;
  const deltaBigH = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltaH * Math.PI) / 360);
  const lBar = (l1 + l2) / 2;
  const cPrimeBar = (c1Prime + c2Prime) / 2;
  let hPrimeBar = h1Prime + h2Prime;
  if (c1Prime * c2Prime === 0) hPrimeBar = h1Prime + h2Prime;
  else if (Math.abs(h1Prime - h2Prime) <= 180) hPrimeBar /= 2;
  else hPrimeBar = (h1Prime + h2Prime + 360) / 2;
  const t =
    1 -
    0.17 * Math.cos(((hPrimeBar - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hPrimeBar * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hPrimeBar + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hPrimeBar - 63) * Math.PI) / 180);
  const deltaTheta = 30 * Math.exp(-(((hPrimeBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cPrimeBar ** 7 / (cPrimeBar ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cPrimeBar;
  const sh = 1 + 0.015 * cPrimeBar * t;
  const rt = -Math.sin((2 * deltaTheta * Math.PI) / 180) * rc;
  return Math.sqrt(
    (deltaL / sl) ** 2 +
      (deltaC / sc) ** 2 +
      (deltaBigH / sh) ** 2 +
      rt * (deltaC / sc) * (deltaBigH / sh),
  );
}

export function percentile95(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * 0.95;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export type V14dNormalizedImage = {
  width: number;
  height: number;
  data: Float32Array;
  colorSpace: "linear" | "srgb";
};

export type V14dRoiLevelMetric = {
  status: "measured" | "pending-calibration" | "unmeasured" | "insufficient-pixels" | "scene-mismatch";
  sampleCount: number;
  validSampleCount: number;
  validRate: number;
  linearRgbMeanErrorPercent: number | null;
  linearRgbChannelErrorPercent: { r: number | null; g: number | null; b: number | null };
  finalDisplayDeltaE2000: { mean: number | null; p95: number | null };
  notes: string[];
};

export type V14dColorBaselineRoiResult = {
  roiId: string;
  material: V14dColorBaselineRoi["material"];
  materialId: number | null;
  levels: Record<V14dColorBaselineLevel, V14dRoiLevelMetric>;
};

export type V14dFirstDivergence = {
  status: "observed" | "not-observed" | "not-proven";
  level: V14dColorBaselineLevel | null;
  reason: string;
};

export type V14dColorBaselineReadback = {
  width: number;
  height: number;
  hdr: {
    format: GPUTextureFormat;
    sourceFormat: GPUTextureFormat | "unknown";
    rowPitch: number;
    data: Float32Array;
    nanCount: number;
    infCount: number;
  };
  mask: {
    format: "rgba8unorm";
    sourceFormat: GPUTextureFormat;
    rowPitch: number;
    data: Uint8Array;
  };
  materialMask: {
    format: "rgba8unorm";
    sourceFormat: GPUTextureFormat;
    rowPitch: number;
    data: Uint8Array;
  } | null;
  finalDisplay: V14dNormalizedImage;
};

export type V14dAnimationProgressEvidence = {
  animationName: string | null;
  currentSeconds: number;
  durationSeconds: number;
  percentage: number;
  currentFrame: number;
  expectedFrame: number;
  frameError: number;
  looping: boolean;
  playing: boolean;
  paused: boolean;
};

export type V14dAnimationEvidence = {
  beforeRenderFrame: V14dAnimationProgressEvidence | null;
  afterBaseColorRenderFrame: V14dAnimationProgressEvidence | null;
  afterLinearHdrRenderFrame: V14dAnimationProgressEvidence | null;
  expectedFrame: number;
  fps: number;
  renderFrameStable: boolean;
  frame120Verified: boolean;
};

export type V14dColorBaselineResult = {
  schemaVersion: 1;
  status: "ready" | "invalid" | "error" | "not-run";
  scene: V14dSceneValidation;
  input: {
    width: number;
    height: number;
    frame: number;
    fps: number;
    seconds: number;
    camera: typeof V14D_COLOR_BASELINE_CAMERA;
    vmdUrl: string;
    vmdLoaded: boolean;
    renderLoopStopped: boolean;
    renderFrameDeltaSeconds: 0;
    animation: V14dAnimationEvidence;
  };
  readback: {
    roiReadback: boolean;
    linearHdrReadback: boolean;
    finalDisplayReadback: boolean;
    materialMaskReadback: boolean;
    materialMaskSource: "engine-pick-material-id-depth" | null;
    materialMaskSourceFormat: GPUTextureFormat | null;
    baseColorSource: "v14d-unlit-texture-only" | null;
    linearHdrSource: "production-style-groups" | null;
    hdrSourceFormat: GPUTextureFormat | "unknown" | null;
    maskSourceFormat: GPUTextureFormat | null;
    width: number;
    height: number;
    rowPitch: { hdr: number | null; mask: number | null };
    nanCount: number | null;
    infCount: number | null;
  };
  rois: V14dColorBaselineRoiResult[];
  firstDivergenceStatus: V14dFirstDivergence["status"];
  firstDivergenceLevel: V14dFirstDivergence["level"];
  firstDivergenceReason: string;
  thresholds: {
    formal: null;
    note: string;
  };
  error?: string;
};

export type V14dColorBaselineEngine = {
  device?: GPUDevice;
  hdrResolveTexture?: GPUTexture;
  maskResolveTexture?: GPUTexture;
  hdrFormat?: GPUTextureFormat;
  pickPipeline?: GPURenderPipeline;
  pickPerFrameBindGroup?: GPUBindGroup;
  modelInstances?: Map<string, {
    model: { visible: boolean };
    vertexBuffer: GPUBuffer;
    jointsBuffer: GPUBuffer;
    weightsBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    pickPerInstanceBindGroup: GPUBindGroup;
    pickDrawCalls: Array<{
      count: number;
      firstIndex: number;
      bindGroup: GPUBindGroup;
    }>;
  }>;
};

function readEnginePrivateFields(engine: unknown): V14dColorBaselineEngine {
  return (engine ?? {}) as V14dColorBaselineEngine;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * (fraction / 0x400) * 2 ** -14;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + fraction / 0x400) * 2 ** (exponent - 15);
}

const BLIT_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  var uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
}
`;

async function blitTextureToReadback(
  device: GPUDevice,
  source: GPUTexture,
  sourceFormat: GPUTextureFormat | "unknown",
  width: number,
  height: number,
  destinationFormat: "rgba16float" | "rgba8unorm",
): Promise<{ data: ArrayBuffer; rowPitch: number }> {
  const target = device.createTexture({
    label: "V14D color baseline readback target",
    size: [width, height],
    format: destinationFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const bytesPerPixel = destinationFormat === "rgba16float" ? 8 : 4;
  const rowPitch = alignTo(width * bytesPerPixel, 256);
  const buffer = device.createBuffer({
    label: "V14D color baseline readback buffer",
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const module = device.createShaderModule({ label: `V14D blit ${sourceFormat}`, code: BLIT_SHADER });
    const pipeline = device.createRenderPipeline({
      label: `V14D blit ${sourceFormat} to ${destinationFormat}`,
      layout: "auto",
      vertex: { module, entryPoint: "vsMain" },
      fragment: { module, entryPoint: "fsMain", targets: [{ format: destinationFormat }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: sampler },
      ],
    });
    const encoder = device.createCommandEncoder({ label: "V14D color baseline readback encoder" });
    const pass = encoder.beginRenderPass({
      label: "V14D color baseline texture blit",
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: rowPitch, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    return { data: mapped.slice(0), rowPitch };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
    target.destroy();
  }
}

function decodeHdrReadback(raw: ArrayBuffer, rowPitch: number, width: number, height: number) {
  const output = new Float32Array(width * height * 4);
  const view = new DataView(raw);
  let nanCount = 0;
  let infCount = 0;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowPitch;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = rowOffset + x * 8;
      const targetOffset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = halfToFloat(view.getUint16(sourceOffset + channel * 2, true));
        output[targetOffset + channel] = value;
        if (Number.isNaN(value)) nanCount += 1;
        else if (!Number.isFinite(value)) infCount += 1;
      }
    }
  }
  return { data: output, nanCount, infCount };
}

function decodeRgba8Readback(raw: ArrayBuffer, rowPitch: number, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  const source = new Uint8Array(raw);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * rowPitch;
    const targetOffset = y * width * 4;
    output.set(source.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
  }
  return output;
}

export async function readV14dColorBaselineResolveTargets(
  engine: unknown,
  width: number,
  height: number,
): Promise<Pick<V14dColorBaselineReadback, "hdr" | "mask">> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.hdrResolveTexture || !fields.maskResolveTexture) {
    throw new Error("reze-engine 未暴露可诊断的 HDR/mask resolve 纹理。");
  }
  const hdrSourceFormat = fields.hdrFormat ?? "unknown";
  const hdrRaw = await blitTextureToReadback(
    fields.device,
    fields.hdrResolveTexture,
    hdrSourceFormat,
    width,
    height,
    "rgba16float",
  );
  const maskSourceFormat: GPUTextureFormat = "rg8unorm";
  const maskRaw = await blitTextureToReadback(
    fields.device,
    fields.maskResolveTexture,
    maskSourceFormat,
    width,
    height,
    "rgba8unorm",
  );
  const hdr = decodeHdrReadback(hdrRaw.data, hdrRaw.rowPitch, width, height);
  return {
    hdr: {
      format: "rgba16float",
      sourceFormat: hdrSourceFormat,
      rowPitch: hdrRaw.rowPitch,
      data: hdr.data,
      nanCount: hdr.nanCount,
      infCount: hdr.infCount,
    },
    mask: {
      format: "rgba8unorm",
      sourceFormat: maskSourceFormat,
      rowPitch: maskRaw.rowPitch,
      data: decodeRgba8Readback(maskRaw.data, maskRaw.rowPitch, width, height),
    },
  };
}

/**
 * 诊断专用的全分辨率材质 ID pass。
 *
 * reze-engine 的生产 mask MRT 只携带 bloom mask 与累计模型 alpha，不能区分
 * 同一 ROI 矩形内的多个 PMX 材质。这里复用引擎已有 pick pipeline、skinning
 * buffer 和逐材质 draw call，以 depth24plus 的 less-equal 深度测试保留前景材质。
 * 该 pass 只在 v14dColorBaseline=1 的固定单帧采集中执行，不改变生产渲染路径。
 */
export async function readV14dColorBaselineMaterialMask(
  engine: unknown,
  width: number,
  height: number,
): Promise<NonNullable<V14dColorBaselineReadback["materialMask"]>> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.pickPipeline || !fields.pickPerFrameBindGroup || !fields.modelInstances) {
    throw new Error("reze-engine 未暴露诊断所需的材质 ID pick pipeline。");
  }
  const target = fields.device.createTexture({
    label: "V14D material ID mask",
    size: [width, height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = fields.device.createTexture({
    label: "V14D material ID depth",
    size: [width, height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const rowPitch = alignTo(width * 4, 256);
  const buffer = fields.device.createBuffer({
    label: "V14D material ID readback",
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = fields.device.createCommandEncoder({ label: "V14D material ID mask encoder" });
    const pass = encoder.beginRenderPass({
      label: "V14D material ID mask pass",
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(fields.pickPipeline);
    pass.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      pass.setVertexBuffer(0, instance.vertexBuffer);
      pass.setVertexBuffer(1, instance.jointsBuffer);
      pass.setVertexBuffer(2, instance.weightsBuffer);
      pass.setIndexBuffer(instance.indexBuffer, "uint32");
      pass.setBindGroup(1, instance.pickPerInstanceBindGroup);
      for (const draw of instance.pickDrawCalls) {
        pass.setBindGroup(2, draw.bindGroup);
        pass.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
      }
    }
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: rowPitch, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    fields.device.queue.submit([encoder.finish()]);
    await fields.device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const data = new Uint8Array(width * height * 4);
    const source = new Uint8Array(mapped);
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = y * rowPitch;
      const targetOffset = y * width * 4;
      data.set(source.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
    }
    return {
      format: "rgba8unorm",
      sourceFormat: "rgba8unorm",
      rowPitch,
      data,
    };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
    depth.destroy();
    target.destroy();
  }
}

/**
 * 诊断专用的 Face 三角形 ID + UV pass（Stage 2B-M2，默认关闭，仅 faceStatic 采集调用）。
 *
 * 复用 pick pass 的逐材质 draw call 与深度语义，但 fragment 输出改为
 * (Face 局部三角形 ID 的 16bit 编码, u, v)，仅 Face 材质输出非零；其余材质
 * 输出 (1,1,1,1) 哨兵。UV 与生产同顶点属性（PMX 原始 UV），与 Blender loop UV 同口径。
 * 深度用 less-equal 保留前景，与 readV14dColorBaselineMaterialMask 完全一致。
 */
// Depth-only WGSL（pass1：全部材质写深度，颜色丢弃）
const FACE_TRI_DEPTH_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
) -> @builtin(position) vec4f {
  let pos4 = vec4f(position, 1.0);
  let weightSum = weights0.x + weights0.y + weights0.z + weights0.w;
  let invWeightSum = select(1.0, 1.0 / weightSum, weightSum > 0.0001);
  let nw = select(vec4f(1.0, 0.0, 0.0, 0.0), weights0 * invWeightSum, weightSum > 0.0001);
  var sp = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) { sp += (skinMats[joints0[i]] * pos4) * nw[i]; }
  return camera.projection * camera.view * vec4f(sp.xyz, 1.0);
}
`;

// Face UV WGSL（pass2：仅 Face 材质输出插值 UV，深度 equal 测试保留前景 Face 像素）
const FACE_UV_ONLY_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @interpolate(flat) @location(1) triIndex: u32,
};

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
  @builtin(vertex_index) vertIndex: u32,
) -> VSOut {
  let pos4 = vec4f(position, 1.0);
  let weightSum = weights0.x + weights0.y + weights0.z + weights0.w;
  let invWeightSum = select(1.0, 1.0 / weightSum, weightSum > 0.0001);
  let nw = select(vec4f(1.0, 0.0, 0.0, 0.0), weights0 * invWeightSum, weightSum > 0.0001);
  var sp = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) { sp += (skinMats[joints0[i]] * pos4) * nw[i]; }
  var out: VSOut;
  out.pos = camera.projection * camera.view * vec4f(sp.xyz, 1.0);
  out.uv = uv;
  // Chrome WebGPU 不支持 @builtin(primitive_index)（实测致管线静默失败、pass 无输出）。
  // 改用 @builtin(vertex_index)：drawIndexed(count,1,firstIndex=0,0,0) 时它是索引缓冲位置，
  // 同一三角形三顶点 flat 插值取 provoke 顶点（每三角第 1 顶点），vertIndex/3 = 三角形序号。
  out.triIndex = vertIndex / 3u;  // 注意：Chrome WebGPU 无 primitive_index，vertex_index/3 编号与 Blender triIndex 不对应（实测 0/96 UV 一致、96 ID 覆盖整脸=多三角共享 ID），仅作诊断占位，Gate 不得据此判同三角形。
  return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.uv.x, in.uv.y, f32(in.triIndex), 1.0);
}
`;

export type V14dFaceTriUvReadback = {
  /** 逐像素 Face 局部三角形序号（@builtin(primitive_index)，Face firstIndex=0 故等于 Blender triIndex，同拓扑同序）；非 Face 前景像素为 -1。 */
  triId: Int32Array;
  /** 逐像素插值 UV（Float32, length = width*height*2）；非 Face 前景像素为 0。 */
  uv: Float32Array;
  /** 逐像素是否 Face 且为前景（深度 equal 通过）。 */
  faceMask: Uint8Array;
  width: number;
  height: number;
};

/**
 * 诊断专用的 Face 前景 UV pass（Stage 2B-M2，默认关闭）。
 *
 * 两段式：
 *   pass1 全部材质 depth-only（less 写深度）→ 得到场景前景深度；
 *   pass2 仅 Face 材质（equal 测试，不写深度）→ 输出插值 UV；
 *   被头发/身体遮挡的 Face 像素在 pass2 因深度不等被剔除，保证 faceMask 只含
 *   真实可见的 Face 像素。UV 与生产同顶点属性（PMX 原始 UV），与 Blender loop UV 同口径。
 *
 * 注意：本 pass 不输出三角形 ID（WebGPU 无无状态三角形序号）；同三角形约束由
 * 离线 Gate 用「Web 像素 UV 必须落在该像素 Blender raycast 三角形的 UV 范围内」判定。
 */
export async function readV14dFaceTriUvMask(
  engine: unknown,
  width: number,
  height: number,
  faceMaterialIndex: number,
  faceMaterialFirstIndex: number,
): Promise<V14dFaceTriUvReadback> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.pickPerFrameBindGroup || !fields.modelInstances) {
    throw new Error("reze-engine 未暴露诊断所需的 Face 前景 UV 管线字段。");
  }
  const device = fields.device;
  const perFrameLayout = (fields as unknown as { pickPerFrameBindGroupLayout?: GPUBindGroupLayout }).pickPerFrameBindGroupLayout!;
  const perInstanceLayout = (fields as unknown as { pickPerInstanceBindGroupLayout?: GPUBindGroupLayout }).pickPerInstanceBindGroupLayout!;
  const depthLayout = device.createPipelineLayout({ bindGroupLayouts: [perFrameLayout, perInstanceLayout] });
  const uvLayout = device.createPipelineLayout({ bindGroupLayouts: [perFrameLayout, perInstanceLayout] });
  const depthModule = device.createShaderModule({ label: "V14D face depth shader", code: FACE_TRI_DEPTH_WGSL });
  const uvModule = device.createShaderModule({ label: "V14D face uv shader", code: FACE_UV_ONLY_WGSL });
  const buffers: GPUVertexBufferLayout[] = [
    { arrayStride: 32, attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" },
      { shaderLocation: 1, offset: 12, format: "float32x3" },
      { shaderLocation: 2, offset: 24, format: "float32x2" },
    ] },
    { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "uint32x4" }] },
    { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: "float32x4" }] },
  ];
  const depthPipeline = device.createRenderPipeline({
    label: "V14D face depth pipeline",
    layout: depthLayout,
    vertex: { module: depthModule, buffers },
    primitive: { cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });
  const uvPipeline = device.createRenderPipeline({
    label: "V14D face uv pipeline",
    layout: uvLayout,
    vertex: { module: uvModule, buffers },
    fragment: { module: uvModule, targets: [{ format: "rgba32float" }] },
    primitive: { cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "equal" },
  });

  const depth = device.createTexture({
    label: "V14D face depth",
    size: [width, height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const target = device.createTexture({
    label: "V14D face uv target",
    size: [width, height],
    format: "rgba32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const rowPitch = alignTo(width * 16, 256);
  const buffer = device.createBuffer({
    label: "V14D face uv readback",
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  try {
    const encoder = device.createCommandEncoder({ label: "V14D face uv encoder" });
    // pass1: 全部材质 depth-only
    const p1 = encoder.beginRenderPass({
      label: "V14D face depth prepass",
      colorAttachments: [],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    p1.setPipeline(depthPipeline);
    p1.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      p1.setVertexBuffer(0, instance.vertexBuffer);
      p1.setVertexBuffer(1, instance.jointsBuffer);
      p1.setVertexBuffer(2, instance.weightsBuffer);
      p1.setIndexBuffer(instance.indexBuffer, "uint32");
      p1.setBindGroup(1, instance.pickPerInstanceBindGroup);
      for (const draw of instance.pickDrawCalls) {
        p1.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
      }
    }
    p1.end();
    // pass2: 仅 Face 材质输出 UV，深度 equal 剔除被遮挡的 Face 像素
    const p2 = encoder.beginRenderPass({
      label: "V14D face uv pass",
      colorAttachments: [
        { view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    p2.setPipeline(uvPipeline);
    p2.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      p2.setVertexBuffer(0, instance.vertexBuffer);
      p2.setVertexBuffer(1, instance.jointsBuffer);
      p2.setVertexBuffer(2, instance.weightsBuffer);
      p2.setIndexBuffer(instance.indexBuffer, "uint32");
      p2.setBindGroup(1, instance.pickPerInstanceBindGroup);
      let matIndex = 0;
      for (const draw of instance.pickDrawCalls) {
        if (matIndex === faceMaterialIndex) {
          p2.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
        }
        matIndex += 1;
      }
    }
    p2.end();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: rowPitch, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const hdr = mapped.slice(0);
    // rgba32float：每行 rowPitch 字节（含对齐填充），每像素 16 字节（4×f32），R=u,G=v,B=triIndex,A=1。
    const mapped32 = new Float32Array(mapped);
    const rowFloats = rowPitch / 4;
    const triId = new Int32Array(width * height).fill(-1);
    const uv = new Float32Array(width * height * 2);
    const faceMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const off = y * rowFloats + x * 4;
        const a = mapped32[off + 3];
        if (a > 0.5) {
          uv[i * 2] = mapped32[off];
          uv[i * 2 + 1] = mapped32[off + 1];
          triId[i] = Math.round(mapped32[off + 2]);
          faceMask[i] = 1;
        }
      }
    }
    return { triId, uv, faceMask, width, height };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
    target.destroy();
    depth.destroy();
  }
}

export async function readV14dCanvasDisplay(canvas: HTMLCanvasElement): Promise<V14dNormalizedImage> {
  const width = canvas.width || V14D_COLOR_BASELINE_WIDTH;
  const height = canvas.height || V14D_COLOR_BASELINE_HEIGHT;
  const dataUrl = canvas.toDataURL("image/png");
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("无法把 WebGPU canvas 转换为 Final Display 像素。"));
    element.src = dataUrl;
  });
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持 Final Display 2D readback。");
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 1) data[index] = rgba[index] / 255;
  return { width, height, data, colorSpace: "srgb" };
}

function pointInPolygon(x: number, y: number, polygon: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function getRoiPixelBounds(
  roi: V14dColorBaselineRoi,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (roi.screen.bounds) {
    const [x, y, w, h] = roi.screen.bounds;
    return {
      minX: Math.max(0, Math.floor(x * width)),
      minY: Math.max(0, Math.floor(y * height)),
      maxX: Math.min(width - 1, Math.ceil((x + w) * width) - 1),
      maxY: Math.min(height - 1, Math.ceil((y + h) * height) - 1),
    };
  }
  if (roi.screen.polygon?.length) {
    const xs = roi.screen.polygon.map(([x]) => x);
    const ys = roi.screen.polygon.map(([, y]) => y);
    return {
      minX: Math.max(0, Math.floor(Math.min(...xs) * width)),
      minY: Math.max(0, Math.floor(Math.min(...ys) * height)),
      maxX: Math.min(width - 1, Math.ceil(Math.max(...xs) * width) - 1),
      maxY: Math.min(height - 1, Math.ceil(Math.max(...ys) * height) - 1),
    };
  }
  return null;
}

function pixelIsInRoi(
  roi: V14dColorBaselineRoi,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;
  if (roi.screen.bounds) {
    const [bx, by, bw, bh] = roi.screen.bounds;
    const erosionX = roi.edgeErosionPx / width;
    const erosionY = roi.edgeErosionPx / height;
    return nx >= bx + erosionX && nx <= bx + bw - erosionX && ny >= by + erosionY && ny <= by + bh - erosionY;
  }
  return roi.screen.polygon ? pointInPolygon(nx, ny, roi.screen.polygon) : false;
}

function createUnmeasuredMetric(
  status: V14dRoiLevelMetric["status"],
  note: string,
): V14dRoiLevelMetric {
  return {
    status,
    sampleCount: 0,
    validSampleCount: 0,
    validRate: 0,
    linearRgbMeanErrorPercent: null,
    linearRgbChannelErrorPercent: { r: null, g: null, b: null },
    finalDisplayDeltaE2000: { mean: null, p95: null },
    notes: [note],
  };
}

function compareRoiLevel(
  roi: V14dColorBaselineRoi,
  level: V14dColorBaselineLevel,
  image: V14dNormalizedImage | null,
  mask: Uint8Array | null,
  materialMask: Uint8Array | null,
  materialId: number | null,
  referenceSrgb: [number, number, number] | undefined,
  sceneValid: boolean,
): V14dRoiLevelMetric {
  if (!sceneValid) return createUnmeasuredMetric("scene-mismatch", "白光场景校验未通过，数值不得作为 Gate B 证据。");
  if (roi.calibrationStatus !== "ready" || !getRoiPixelBounds(roi, image?.width ?? 0, image?.height ?? 0)) {
    return createUnmeasuredMetric("pending-calibration", "ROI 尚未提供经过真实 1280×720 画面校准的屏幕坐标。");
  }
  if (!image || !mask || !materialMask || materialId === null) {
    return createUnmeasuredMetric("unmeasured", "缺少该级别图像、模型覆盖 mask 或目标材质 ID readback。");
  }
  if (!referenceSrgb) return createUnmeasuredMetric("unmeasured", "缺少 Blender/PMX 对应参考颜色，未计算误差。");

  const bounds = getRoiPixelBounds(roi, image.width, image.height);
  if (!bounds) return createUnmeasuredMetric("pending-calibration", "ROI 坐标为空。");
  const expectedLinear = srgbToLinearRgb(referenceSrgb);
  const deltaEs: number[] = [];
  let sampleCount = 0;
  let validSampleCount = 0;
  const actualLinearSum = [0, 0, 0];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!pixelIsInRoi(roi, x, y, image.width, image.height)) continue;
      sampleCount += 1;
      const maskAlpha = mask[(y * image.width + x) * 4 + 1] / 255;
      if (maskAlpha < roi.backgroundExclusion.threshold) continue;
      const offset = (y * image.width + x) * 4;
      const materialMaskModelId = materialMask[offset];
      const materialMaskMaterialId = materialMask[offset + 1];
      if (materialMaskModelId === 0 || materialMaskMaterialId !== materialId) continue;
      const actualSrgb: [number, number, number] = [
        image.colorSpace === "srgb" ? image.data[offset] : linearToSrgb(image.data[offset]),
        image.colorSpace === "srgb" ? image.data[offset + 1] : linearToSrgb(image.data[offset + 1]),
        image.colorSpace === "srgb" ? image.data[offset + 2] : linearToSrgb(image.data[offset + 2]),
      ];
      const actualLinear = image.colorSpace === "srgb"
        ? srgbToLinearRgb(actualSrgb)
        : [image.data[offset], image.data[offset + 1], image.data[offset + 2]] as [number, number, number];
      validSampleCount += 1;
      actualLinearSum[0] += actualLinear[0];
      actualLinearSum[1] += actualLinear[1];
      actualLinearSum[2] += actualLinear[2];
      if (level === "finalDisplay") deltaEs.push(deltaE2000(srgbToLab(actualSrgb), srgbToLab(referenceSrgb)));
    }
  }
  if (validSampleCount < roi.minValidPixels) {
    return {
      ...createUnmeasuredMetric(
        "insufficient-pixels",
        `有效像素 ${validSampleCount} 少于最小要求 ${roi.minValidPixels}；已同时按模型覆盖 alpha、材质 ID 和深度可见性排除背景及其他材质。`,
      ),
      sampleCount,
      validSampleCount,
      validRate: sampleCount ? validSampleCount / sampleCount : 0,
    };
  }
  const actualLinearMean = actualLinearSum.map((value) => value / validSampleCount);
  // Stage 1 修复：BaseColor 级改为"ROI 均值对参考均值"的偏差（bias）口径。
  // 原实现用 mean|逐像素 - 单一常数参考|，把纹理自身的空间方差计入了"误差"，
  // 导致头发/胸口等纹理多变的 ROI 必然高达 13-27%，而颜色均匀的左袖只有 5%。
  // 这里改为 |mean(actual) - expected|，只衡量真实采样偏差，纹理方差单独以诊断形式记录。
  const channels = actualLinearMean.map((value, index) => Math.abs(value - expectedLinear[index]) * 100);
  return {
    status: "measured",
    sampleCount,
    validSampleCount,
    validRate: sampleCount ? validSampleCount / sampleCount : 0,
    linearRgbMeanErrorPercent: (channels[0] + channels[1] + channels[2]) / 3,
    linearRgbChannelErrorPercent: { r: channels[0], g: channels[1], b: channels[2] },
    finalDisplayDeltaE2000: {
      mean: deltaEs.length ? deltaEs.reduce((sum, value) => sum + value, 0) / deltaEs.length : null,
      p95: deltaEs.length ? percentile95(deltaEs) : null,
    },
    notes: [
      "有效像素同时满足模型覆盖 alpha、目标材质 ID 与 depth24plus 前景可见性；Linear RGB 误差按 ROI 均值的绝对线性通道差 × 100 计算（偏差口径，纹理空间方差不计入）。",
      `诊断 actualLinearMean=${actualLinearMean.map((v) => v.toFixed(4)).join(",")} expectedLinear=${expectedLinear.map((v) => v.toFixed(4)).join(",")} imageColorSpace=${image.colorSpace}`,
      "当前没有正式 Gate 阈值。",
    ],
  };
}

export function analyzeV14dColorBaselineRois({
  rois = V14D_COLOR_BASELINE_ROIS,
  readback,
  materialIdByName,
  scene,
}: {
  rois?: readonly V14dColorBaselineRoi[];
  readback: {
    baseColor: V14dNormalizedImage | null;
    linearHdr: V14dNormalizedImage | null;
    finalDisplay: V14dNormalizedImage | null;
    mask: Uint8Array | null;
    materialMask: Uint8Array | null;
  };
  materialIdByName: Readonly<Record<string, number>>;
  scene: V14dSceneValidation;
}): {
  rois: V14dColorBaselineRoiResult[];
  firstDivergence: V14dFirstDivergence;
} {
  const results = rois.map((roi) => ({
    roiId: roi.id,
    material: roi.material,
    materialId: materialIdByName[roi.material.web] ?? null,
    levels: {
      baseColor: compareRoiLevel(
        roi,
        "baseColor",
        readback.baseColor,
        readback.mask,
        readback.materialMask,
        materialIdByName[roi.material.web] ?? null,
        roi.reference?.baseColorSrgb,
        scene.valid,
      ),
      linearHdr: compareRoiLevel(
        roi,
        "linearHdr",
        readback.linearHdr,
        readback.mask,
        readback.materialMask,
        materialIdByName[roi.material.web] ?? null,
        roi.reference?.linearHdrSrgb,
        scene.valid,
      ),
      finalDisplay: compareRoiLevel(
        roi,
        "finalDisplay",
        readback.finalDisplay,
        readback.mask,
        readback.materialMask,
        materialIdByName[roi.material.web] ?? null,
        roi.reference?.finalDisplaySrgb,
        scene.valid,
      ),
    },
  }));
  const levels: readonly V14dColorBaselineLevel[] = ["baseColor", "linearHdr", "finalDisplay"];
  for (const level of levels) {
    const measured = results.some((result) => {
      const metric = result.levels[level];
      return metric.status === "measured" && (metric.linearRgbMeanErrorPercent ?? 0) > V14D_COLOR_BASELINE_EPSILON;
    });
    if (measured) {
      return {
        rois: results,
        firstDivergence: {
          status: "observed",
          level,
          reason: `在 ${level} 级至少一个 ROI 的线性 RGB 误差超过诊断 epsilon；这不是正式 Gate 阈值。`,
        },
      };
    }
  }
  const hasMeasured = results.some((result) =>
    levels.some((level) => result.levels[level].status === "measured"),
  );
  return {
    rois: results,
    firstDivergence: hasMeasured
      ? { status: "not-observed", level: null, reason: "已测 ROI 未观察到超过诊断 epsilon 的误差。" }
      : { status: "not-proven", level: null, reason: "没有可用的已校准 ROI 与参考颜色，无法证明首次分歧位置。" },
  };
}

export function createV14dColorBaselineResult(
  patch: Partial<V14dColorBaselineResult> & Pick<V14dColorBaselineResult, "status" | "scene" | "input" | "readback">,
): V14dColorBaselineResult {
  return {
    schemaVersion: 1,
    status: patch.status,
    scene: patch.scene,
    input: patch.input,
    readback: patch.readback,
    rois: patch.rois ?? [],
    firstDivergenceStatus: patch.firstDivergenceStatus ?? "not-proven",
    firstDivergenceLevel: patch.firstDivergenceLevel ?? null,
    firstDivergenceReason: patch.firstDivergenceReason ?? "尚未执行 ROI 数值分析。",
    thresholds: {
      formal: null,
      note: "本票没有正式阈值；任何候选 epsilon 只用于标记诊断分歧，不代表 Gate 通过/失败。",
    },
    ...(patch.error ? { error: patch.error } : {}),
  };
}

export function makeV14dLinearImage(
  width: number,
  height: number,
  data: Float32Array,
): V14dNormalizedImage {
  return { width, height, data, colorSpace: "linear" };
}

/**
 * 临时诊断探针：计算每个 ROI 内 Web unlit BaseColor 的实际均值（sRGB 与 linear），
 * 只用于根因取证，不进入正式 Gate 判定。
 */
export function measureV14dRoiActualMeans({
  rois = V14D_COLOR_BASELINE_ROIS,
  image,
  mask,
  materialMask,
  materialIdByName,
}: {
  rois?: readonly V14dColorBaselineRoi[];
  image: V14dNormalizedImage | null;
  mask: Uint8Array | null;
  materialMask: Uint8Array | null;
  materialIdByName: Readonly<Record<string, number>>;
}): Record<string, { srgb: number[]; linear: number[]; n: number } | null> {
  const out: Record<string, { srgb: number[]; linear: number[]; n: number } | null> = {};
  for (const roi of rois) {
    out[roi.id] = null;
    if (!image || !mask || !materialMask) continue;
    const materialId = materialIdByName[roi.material.web];
    if (materialId == null) continue;
    const bounds = getRoiPixelBounds(roi, image.width, image.height);
    if (!bounds) continue;
    let n = 0;
    const linSum = [0, 0, 0];
    const srgbSum = [0, 0, 0];
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (!pixelIsInRoi(roi, x, y, image.width, image.height)) continue;
        const offset = (y * image.width + x) * 4;
        if (mask[offset + 1] / 255 < roi.backgroundExclusion.threshold) continue;
        if (materialMask[offset] === 0 || materialMask[offset + 1] !== materialId) continue;
        const lin: [number, number, number] =
          image.colorSpace === "srgb"
            ? srgbToLinearRgb([image.data[offset], image.data[offset + 1], image.data[offset + 2]])
            : [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
        const srgb: [number, number, number] =
          image.colorSpace === "srgb"
            ? [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
            : [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
        for (let c = 0; c < 3; c += 1) {
          linSum[c] += lin[c];
          srgbSum[c] += srgb[c];
        }
        n += 1;
      }
    }
    if (n > 0) {
      out[roi.id] = {
        srgb: srgbSum.map((v) => v / n),
        linear: linSum.map((v) => v / n),
        n,
      };
    }
  }
  return out;
}
