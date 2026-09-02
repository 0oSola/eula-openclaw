/** v14dHairPartition.js 的类型声明（与实现同步维护）。 */

export declare const V14D_HAIR_TINT_LINEAR: readonly [number, number, number];

export type PmxMaterialFaceRange = {
  name: string;
  startIndex: number;
  indexCount: number;
};

export type HairUvGrid = {
  gridU: number;
  gridV: number;
  hairA: Uint32Array;
  hairB: Uint32Array;
};

export declare function srgbByteToLinear(c: number): number;
export declare function linearToSrgbByte(l: number): number;
export declare function v14dHairTargetDisplay(rgb: [number, number, number]): [number, number, number];
export declare function buildHairUvGridFromPmx(
  pmx: ArrayBuffer,
  ranges: { hairA: PmxMaterialFaceRange; hairB: PmxMaterialFaceRange },
  gridU?: number,
  gridV?: number,
): HairUvGrid;
export declare function classifyHairPixel(
  grid: HairUvGrid,
  px: number,
  py: number,
  texW: number,
  texH: number,
): "hairA" | "hairB" | null;
