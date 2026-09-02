/** rezeSkinVariantPreference.js shared TS type authority. */
export type RezeK3SkinVariant = "original" | "v1";
export declare const REZE_K3_SKIN_VARIANTS: readonly RezeK3SkinVariant[];
export declare const REZE_K3_SKIN_VARIANT_LABEL: Record<RezeK3SkinVariant, string>;
export declare function isRezeK3SkinVariant(value: unknown): value is RezeK3SkinVariant;
export declare function rezeK3SkinVariantStorageKey(userId: string, modelRelativePath: string): string;
export declare function readRezeK3SkinVariant(storage: Pick<Storage, "getItem">, key: string): RezeK3SkinVariant;
export declare function writeRezeK3SkinVariant(storage: Pick<Storage, "setItem"> & Pick<Storage, "removeItem">, key: string, variant: RezeK3SkinVariant): void;
export declare function isRezeK3V1Eligible(pmxFileName: string): boolean;
export declare function findV14dState2MaskFile(files: readonly File[] | null | undefined): File | null;
export type RezeLocalModelImportLike = { files: File[]; pmxFile: File } | null | undefined;
export declare function evaluateRezeK3V1Eligibility(localModelImport: RezeLocalModelImportLike): { eligible: boolean; hasAuthorityPmx: boolean; hasState2Mask: boolean; state2Mask: File | null; };
export declare function resolveRezeK3SkinVariant(requested: RezeK3SkinVariant, localModelImport: RezeLocalModelImportLike): RezeK3SkinVariant;
