export type EmotionSlot =
  | "neutral"
  | "happy"
  | "sad"
  | "thinking"
  | "excited"
  | "caring";

export type ProceduralAction =
  | "idle"
  | "nod"
  | "wave"
  | "think"
  | "cheer"
  | "comfort"
  | "lean_in"
  | "look_away"
  | "headshake";

export type MotionStep = {
  template: string;
  duration_ms: number;
  intensity: number;
};

export type MotionPlan = {
  sequence: MotionStep[];
};

export type MappingConfig = {
  kind: "procedural" | "vmd";
  value: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  traceId?: string;
};

export type ChatResponse = {
  trace_id: string;
  text: string;
  emotion: EmotionSlot;
  action: ProceduralAction;
  motion_plan?: MotionPlan | null;
  memory_ops: Array<Record<string, unknown>>;
  parse_mode: string;
  endpoint_used: string;
  degraded: boolean;
  fallback_reason?: string | null;
};

export type VmdAsset = {
  asset_id: string;
  user_id: string;
  slot: EmotionSlot;
  filename: string;
  size_bytes: number;
  created_at: string;
  url: string;
};

export type MmdModelAsset = {
  name: string;
  label: string;
  relative_path: string;
  size_bytes: number;
  url: string;
};

export type MmdMotionAsset = {
  name: string;
  label: string;
  relative_path: string;
  size_bytes: number;
  url: string;
};

export type TraceEvent = {
  trace_id: string;
  user_id: string;
  session_id: string | null;
  stage: string;
  status: string;
  latency_ms: number | null;
  error_code: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type TraceMirror = {
  trace_id: string;
  user_id: string;
  request: Record<string, unknown>;
  raw_response: string;
  normalized: Record<string, unknown>;
  endpoint_used: string;
  status: string;
  created_at: string;
};

export type UserSession = {
  userId: string;
  renderPipeline?: "classic" | "genshin";
};
