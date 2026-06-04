import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MMDStage } from "@/features/stage/MMDStage";
import type { MMDStageHandle } from "@/features/stage/MMDStage";
import {
  createStageClickRipple,
  shouldTriggerStageCharacterClick,
  STAGE_CLICK_RIPPLE_DURATION_MS,
} from "@/features/stage/stageCharacterClick.js";
import type { CompanionSharedConfig, MmdCameraSnapshot, MmdModelAsset, RenderPipeline, VmdAsset } from "@/lib/types";

import { getCodexStatusPresentation, type CodexStatus } from "./codex/codexStatus";
import { buildApprovalFallback } from "./codex/approvalFallback";
import { formatCodexStatusNotification } from "./codex/notificationDetail";
import {
  buildSessionPickerItems,
  filterSessionPickerItems,
  type DesktopPetSession,
} from "./codex/sessionPicker";
import { createApiClient } from "./lib/apiClient";
import { describeMainSiteSyncResult, describeMenuActionResult } from "./menu/menuActionStatus";
import {
  loadPetCameraSnapshot,
  preparePetCameraSnapshotForStorage,
  savePetCameraSnapshot,
  shouldPersistPetCameraOnModeChange,
} from "./mmd/petCameraState";
import {
  buildPetAutoplayIdleState,
  buildCodexStatusPetStageResolution,
  buildPetStageClickInteraction,
  buildPetStageClickInteractionState,
  buildPetStageKey,
  pickSelectedModel,
  resetPetStageInteractionState,
} from "./mmd/petStageState";
import { shouldStartPetWindowDrag, shouldStopPetWindowDragPropagation } from "./window/petWindowEvents";

const DEFAULT_USER_ID = "admin-1";
const DEFAULT_SHARED_CONFIG: CompanionSharedConfig = {
  user_id: DEFAULT_USER_ID,
  selected_model_path: null,
  render_pipeline: "classic",
  updated_at: null,
};
type PetInteractionMode = "window-drag" | "camera-adjust";
type NotificationProfile = "low" | "medium" | "high";
type MenuLanguage = "en" | "zh-CN";
type ApiRuntimeStatus = {
  state: "available" | "unavailable";
  available: boolean;
  apiBaseUrl: string;
  healthUrl: string;
  attempts: number;
  started: boolean;
  checkedAt: string;
  autostart: {
    enabled: boolean;
    attempted: boolean;
    reason?: "disabled" | "missing_command" | "spawn_failed";
    command?: string;
    error?: string;
  };
  logPaths?: {
    stdout: string;
    stderr: string;
  };
  error?: string;
};
type DesktopPetMenuAction =
  | { type: "select-workspace" }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: DesktopPetSession[] }
  | { type: "interaction-mode"; mode: PetInteractionMode }
  | { type: "notification-detail"; profile: NotificationProfile }
  | { type: "menu-language"; language: MenuLanguage }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" };
type PetStageInteractionState = ReturnType<typeof resetPetStageInteractionState>;
type StageClickRipple = {
  id: string;
  x: number;
  y: number;
  xPercent?: number;
  yPercent?: number;
};
type StagePointerCandidate = {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
};

function getModelLabel(model: MmdModelAsset): string {
  if (model.label?.trim()) return model.label.trim();
  const parts = model.relative_path.split(/[\\/]/).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return model.name.replace(/\.(pmx|pmd)$/i, "") || "MMD Model";
}

function describeApiRuntimeStatus(status: ApiRuntimeStatus | null): string {
  if (!status) return "API unavailable";
  if (status.available) return status.started ? "API started" : "API available";
  if (status.autostart.enabled && !status.autostart.command) return "API unavailable · start command missing";
  if (status.autostart.attempted && status.logPaths?.stderr) return "API unavailable · logs available";
  return status.error ? `API unavailable · ${status.error}` : "API unavailable";
}

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:8000");
  const [apiRuntimeStatus, setApiRuntimeStatus] = useState<ApiRuntimeStatus | null>(null);
  const [apiRuntimeRetrying, setApiRuntimeRetrying] = useState(false);
  const [sharedConfig, setSharedConfig] = useState<CompanionSharedConfig>(DEFAULT_SHARED_CONFIG);
  const [models, setModels] = useState<MmdModelAsset[]>([]);
  const [vmdAssets, setVmdAssets] = useState<VmdAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [interactionMode, setInteractionMode] = useState<PetInteractionMode>("window-drag");
  const [notificationProfile, setNotificationProfile] = useState<NotificationProfile>("medium");
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [menuStatus, setMenuStatus] = useState<string | null>(null);
  const [stageReloadRevision, setStageReloadRevision] = useState(0);
  const [petCameraRevision, setPetCameraRevision] = useState(0);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [sessionPanelQuery, setSessionPanelQuery] = useState("");
  const [sessionPanelSessions, setSessionPanelSessions] = useState<DesktopPetSession[]>([]);
  const [promptPanelOpen, setPromptPanelOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [stageInteractionState, setStageInteractionState] = useState<PetStageInteractionState>(() =>
    resetPetStageInteractionState(),
  );
  const [stageClickRipples, setStageClickRipples] = useState<StageClickRipple[]>([]);
  const stageRef = useRef<MMDStageHandle | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const stageClickCandidateRef = useRef<StagePointerCandidate | null>(null);
  const lastStageClickVmdAssetIdRef = useRef("");
  const lastStageClickEventRef = useRef<{ atMs: number; clientX: number; clientY: number } | null>(null);
  const previousInteractionModeRef = useRef<PetInteractionMode>("window-drag");

  useEffect(() => {
    window.desktopPet
      ?.runtimeInfo()
      .then((info) => {
        setApiBaseUrl(info.apiBaseUrl);
        setApiRuntimeStatus(info.apiRuntimeStatus ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    window.desktopPet?.interactionMode
      ?.get()
      .then((mode) => setInteractionMode(mode))
      .catch(() => {});
    return window.desktopPet?.interactionMode?.onChanged((mode) => setInteractionMode(mode));
  }, []);

  useEffect(() => {
    window.desktopPet?.notificationProfile
      ?.get()
      .then((profile) => setNotificationProfile(profile))
      .catch(() => {});
  }, []);

  useEffect(() => {
    window.desktopPet?.codexStatus
      ?.get()
      .then((status) => setCodexStatus(status))
      .catch(() => {});
    return window.desktopPet?.codexStatus?.onChanged((status) => setCodexStatus(status));
  }, []);

  const api = useMemo(() => createApiClient({ baseUrl: apiBaseUrl, userId: DEFAULT_USER_ID }), [apiBaseUrl]);
  const selectedModel = pickSelectedModel(models, sharedConfig.selected_model_path);
  const renderPipeline: RenderPipeline = sharedConfig.render_pipeline || "classic";
  const petCameraSnapshot = useMemo<MmdCameraSnapshot | null>(() => {
    if (!selectedModel) return null;
    try {
      return loadPetCameraSnapshot({
        storage: window.localStorage,
        modelPath: selectedModel.relative_path,
        renderPipeline,
      });
    } catch {
      return null;
    }
  }, [petCameraRevision, renderPipeline, selectedModel]);
  const petAutoplayIdleState = useMemo(
    () =>
      selectedModel
        ? buildPetAutoplayIdleState(vmdAssets, selectedModel.relative_path, api.toAbsoluteUrl)
        : resetPetStageInteractionState(),
    [api, selectedModel, vmdAssets],
  );
  const codexStatusPresentation = useMemo(() => getCodexStatusPresentation(codexStatus), [codexStatus]);
  const codexStatusResolution = useMemo(
    () =>
      buildCodexStatusPetStageResolution(codexStatusPresentation, {
        clickInteractionActive: stageInteractionState.source === "stage-click",
      }),
    [codexStatusPresentation, stageInteractionState.source],
  );
  const codexStatusInteraction = codexStatusResolution.shouldApply ? codexStatusResolution.interaction : null;
  const interaction =
    stageInteractionState.source === "stage-click"
      ? stageInteractionState.interaction
      : codexStatusInteraction ?? stageInteractionState.interaction;
  const sessionPickerItems = useMemo(
    () => buildSessionPickerItems(sessionPanelSessions),
    [sessionPanelSessions],
  );
  const filteredSessionPickerItems = useMemo(
    () => filterSessionPickerItems(sessionPickerItems, sessionPanelQuery),
    [sessionPanelQuery, sessionPickerItems],
  );

  const loadPetState = useCallback((options: { syncFeedback?: boolean } = {}) => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([api.getSharedConfig(), api.listModels(), api.listVmdAssets()])
      .then(([nextSharedConfig, nextModels, nextVmdAssets]) => {
        if (cancelled) return;
        setSharedConfig(nextSharedConfig);
        setModels(nextModels);
        setVmdAssets(nextVmdAssets);
        if (options.syncFeedback) {
          const nextSelectedModel = pickSelectedModel(nextModels, nextSharedConfig.selected_model_path);
          setStageReloadRevision((revision) => revision + 1);
          setMenuStatus(
            describeMainSiteSyncResult(
              nextSelectedModel ? getModelLabel(nextSelectedModel) : null,
              nextSharedConfig.render_pipeline || "classic",
            ),
          );
          window.setTimeout(() => setMenuStatus(null), 3600);
        }
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setLoadError(error.message);
        if (options.syncFeedback) {
          setMenuStatus(`Sync failed: ${error.message}`);
          window.setTimeout(() => setMenuStatus(null), 4200);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => loadPetState(), [loadPetState]);

  useEffect(() => {
    return window.desktopPet?.apiRuntime?.onChanged((status) => {
      setApiRuntimeStatus(status);
      if (status?.available) loadPetState();
    });
  }, [loadPetState]);

  useEffect(() => {
    setStageInteractionState(petAutoplayIdleState);
    setStageClickRipples([]);
    lastStageClickVmdAssetIdRef.current = "";
    stageClickCandidateRef.current = null;
  }, [petAutoplayIdleState, renderPipeline, selectedModel?.relative_path, stageReloadRevision]);

  useEffect(() => {
    const previousInteractionMode = previousInteractionModeRef.current;
    if (
      shouldPersistPetCameraOnModeChange(previousInteractionMode, interactionMode) &&
      selectedModel
    ) {
      const snapshot = stageRef.current?.captureCamera();
      const persistedSnapshot = snapshot ? preparePetCameraSnapshotForStorage(snapshot) : null;
      if (persistedSnapshot) {
        try {
          savePetCameraSnapshot({
            storage: window.localStorage,
            modelPath: selectedModel.relative_path,
            renderPipeline,
            snapshot: persistedSnapshot,
          });
          stageRef.current?.lockCamera();
          setPetCameraRevision((revision) => revision + 1);
          setMenuStatus("Pet camera saved");
          window.setTimeout(() => setMenuStatus(null), 1800);
        } catch {
          setMenuStatus("Pet camera save failed");
          window.setTimeout(() => setMenuStatus(null), 2400);
        }
      }
    }
    if (interactionMode === "camera-adjust") {
      stageRef.current?.unlockCamera();
    }
    previousInteractionModeRef.current = interactionMode;
  }, [interactionMode, renderPipeline, selectedModel, stageReloadRevision]);

  useEffect(() => {
    return window.desktopPet?.menu?.onAction((action: DesktopPetMenuAction) => {
      setMenuStatus(describeMenuActionResult(action));
      if (action.type === "more-sessions") {
        setSessionPanelSessions(action.sessions || []);
        setSessionPanelQuery("");
        setSessionPanelOpen(true);
        setPromptPanelOpen(false);
        window.setTimeout(() => setMenuStatus(null), 1800);
        return;
      }
      if (action.type === "send-prompt") {
        setPromptDraft("");
        setPromptPanelOpen(true);
        setSessionPanelOpen(false);
        return;
      }
      if (action.type === "prompt-sent") {
        setPromptPanelOpen(false);
        setPromptDraft("");
        window.setTimeout(() => setMenuStatus(null), 2200);
        return;
      }
      if (action.type === "notification-detail") {
        setNotificationProfile(action.profile);
      }
      if (action.type === "sync-main-site") {
        loadPetState({ syncFeedback: true });
        return;
      }
      window.setTimeout(() => setMenuStatus(null), 2800);
    });
  }, [loadPetState]);

  const restoreSessionFromPanel = useCallback((petSessionId: string) => {
    setSessionPanelOpen(false);
    setMenuStatus("Opening VSCode workspace and resuming Codex...");
    window.desktopPet?.sessions
      ?.restore(petSessionId)
      .catch((error: Error) => {
        setMenuStatus(`Resume failed: ${error.message}`);
        window.setTimeout(() => setMenuStatus(null), 4200);
      });
  }, []);

  const sendPromptFromPanel = useCallback(() => {
    const prompt = promptDraft.trim();
    if (!prompt) {
      setMenuStatus("Prompt is required");
      window.setTimeout(() => setMenuStatus(null), 1800);
      return;
    }
    if (!window.desktopPet?.prompt?.send) {
      setMenuStatus("Prompt unavailable");
      window.setTimeout(() => setMenuStatus(null), 2800);
      return;
    }

    setMenuStatus("Sending prompt...");
    window.desktopPet.prompt.send(prompt).catch((error: Error) => {
      setMenuStatus(`Prompt failed: ${error.message}`);
      window.setTimeout(() => setMenuStatus(null), 4200);
    });
  }, [promptDraft]);

  const retryApiRuntime = useCallback(() => {
    setApiRuntimeRetrying(true);
    setMenuStatus("Checking API...");
    window.desktopPet?.apiRuntime
      ?.retry()
      .then((status) => {
        setApiRuntimeStatus(status);
        if (status?.available) {
          setMenuStatus(describeApiRuntimeStatus(status));
          loadPetState();
        } else {
          setMenuStatus(describeApiRuntimeStatus(status));
          window.setTimeout(() => setMenuStatus(null), 3600);
        }
      })
      .catch((error: Error) => {
        setMenuStatus(`API retry failed: ${error.message}`);
        window.setTimeout(() => setMenuStatus(null), 4200);
      })
      .finally(() => setApiRuntimeRetrying(false));
  }, [loadPetState]);

  const focusVscodeForApproval = useCallback(() => {
    setMenuStatus("Opening VSCode workspace...");
    window.desktopPet?.vscode?.focus?.().catch((error: Error) => {
      setMenuStatus(`Open VSCode failed: ${error.message}`);
      window.setTimeout(() => setMenuStatus(null), 4200);
    });
  }, []);

  const handlePetStageCharacterClick = useCallback(
    ({ clientX, clientY, stageRect }: { clientX: number; clientY: number; stageRect: DOMRect }) => {
      if (!selectedModel?.relative_path) return;
      const nowMs = performance.now();
      const lastClick = lastStageClickEventRef.current;
      if (
        lastClick &&
        nowMs - lastClick.atMs < 80 &&
        Math.abs(lastClick.clientX - clientX) <= 1 &&
        Math.abs(lastClick.clientY - clientY) <= 1
      ) {
        return;
      }
      lastStageClickEventRef.current = { atMs: nowMs, clientX, clientY };

      const ripple = createStageClickRipple({ clientX, clientY, rect: stageRect }) as StageClickRipple;
      setStageClickRipples((current) => [...current.slice(-5), ripple]);
      window.setTimeout(() => {
        setStageClickRipples((current) => current.filter((item) => item.id !== ripple.id));
      }, STAGE_CLICK_RIPPLE_DURATION_MS);

      const clickAction = buildPetStageClickInteraction({
        assets: vmdAssets,
        selectedModelPath: selectedModel.relative_path,
        previousActiveVmdAssetId: lastStageClickVmdAssetIdRef.current,
        resolveUrl: api.toAbsoluteUrl,
      });
      if (clickAction.activeVmdAssetId) {
        lastStageClickVmdAssetIdRef.current = clickAction.activeVmdAssetId;
      }
      setStageInteractionState(buildPetStageClickInteractionState(clickAction));
    },
    [api, selectedModel?.relative_path, vmdAssets],
  );

  const recoverPetStageInteraction = useCallback(() => {
    setStageInteractionState(petAutoplayIdleState);
  }, [petAutoplayIdleState]);

  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      void window.desktopPet?.menu?.openContextMenu({ x: event.clientX, y: event.clientY });
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".pet-panel, .pet-status-action")) return;
      if (interactionMode === "window-drag" && event.button === 0) {
        stageClickCandidateRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          timeStamp: event.timeStamp,
        };
      }
      if (!shouldStartPetWindowDrag({ interactionMode, button: event.button })) return;
      dragPointerIdRef.current = event.pointerId;
      event.preventDefault();
      if (shouldStopPetWindowDragPropagation({ eventType: "pointerdown", dragActive: true })) {
        event.stopPropagation();
      }
      window.desktopPet?.windowDrag?.start();
    }

    function handlePointerMove(event: PointerEvent) {
      if (dragPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      if (shouldStopPetWindowDragPropagation({ eventType: "pointermove", dragActive: true })) {
        event.stopPropagation();
      }
      window.desktopPet?.windowDrag?.move();
    }

    function finishActiveDrag() {
      if (dragPointerIdRef.current === null) return;
      dragPointerIdRef.current = null;
      window.desktopPet?.windowDrag?.end();
    }

    function finishPointerDrag(event: PointerEvent) {
      const candidate = stageClickCandidateRef.current;
      if (dragPointerIdRef.current === event.pointerId) {
        event.preventDefault();
        if (shouldStopPetWindowDragPropagation({ eventType: "pointerup", dragActive: true })) {
          event.stopPropagation();
        }
        finishActiveDrag();
      }
      if (candidate?.pointerId !== event.pointerId) return;
      stageClickCandidateRef.current = null;
      if (
        !shouldTriggerStageCharacterClick({
          downClientX: candidate.clientX,
          downClientY: candidate.clientY,
          upClientX: event.clientX,
          upClientY: event.clientY,
          downTimeMs: candidate.timeStamp,
          upTimeMs: event.timeStamp,
        })
      ) {
        return;
      }
      if (!stageRef.current?.hitTestCharacterAtClientPoint(event.clientX, event.clientY)) return;
      const stageRect = stageRef.current.getStageRect();
      if (!stageRect) return;
      handlePetStageCharacterClick({ clientX: event.clientX, clientY: event.clientY, stageRect });
    }

    function cancelPointerDrag(event: PointerEvent) {
      if (stageClickCandidateRef.current?.pointerId === event.pointerId) {
        stageClickCandidateRef.current = null;
      }
      finishPointerDrag(event);
    }

    function handleBlur() {
      stageClickCandidateRef.current = null;
      finishActiveDrag();
    }

    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", finishPointerDrag, true);
    document.addEventListener("pointercancel", cancelPointerDrag, true);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerup", finishPointerDrag, true);
      document.removeEventListener("pointercancel", cancelPointerDrag, true);
      window.removeEventListener("blur", handleBlur);
      finishActiveDrag();
    };
  }, [handlePetStageCharacterClick, interactionMode]);

  const codexStatusText = formatCodexStatusNotification(codexStatus, notificationProfile);
  const approvalFallback = buildApprovalFallback(codexStatus, notificationProfile);
  const showApiRetry = Boolean(loadError) && !approvalFallback;
  const statusText =
    menuStatus ||
    approvalFallback?.message ||
    codexStatusText ||
    (loadError
      ? describeApiRuntimeStatus(apiRuntimeStatus)
      : loading
        ? "Loading MMD"
        : !selectedModel
          ? `No MMD model · ${notificationProfile}`
          : null);

  return (
    <main
      className="pet-shell"
      data-interaction-mode={interactionMode}
    >
      <div className="pet-input-hit-surface" aria-hidden="true" />
      <div className="pet-stage" data-render-pipeline={renderPipeline}>
        {selectedModel ? (
          <MMDStage
            ref={stageRef}
            key={buildPetStageKey(selectedModel.relative_path, renderPipeline, stageReloadRevision)}
            chrome="bare"
            interaction={interaction}
            speaking={false}
            models={models}
            selectedModelPath={selectedModel.relative_path}
            modelUrl={api.toAbsoluteUrl(selectedModel.url)}
            modelLabel={getModelLabel(selectedModel)}
            renderPipeline={renderPipeline}
            cameraSnapshot={petCameraSnapshot}
            cameraLocked={interactionMode !== "camera-adjust"}
            enableCharacterClickCapture={interactionMode !== "camera-adjust"}
            onCharacterClick={handlePetStageCharacterClick}
            clickRipples={stageClickRipples}
            onInteractionComplete={recoverPetStageInteraction}
            onInteractionError={recoverPetStageInteraction}
            onModelChange={() => {}}
          />
        ) : null}
      </div>
      {sessionPanelOpen ? (
        <section className="pet-panel pet-session-panel" aria-label="Codex sessions">
          <div className="pet-session-panel-header">
            <span>Sessions</span>
            <button
              type="button"
              className="pet-session-panel-close"
              aria-label="Close sessions"
              onClick={() => setSessionPanelOpen(false)}
            >
              x
            </button>
          </div>
          <input
            className="pet-session-search"
            value={sessionPanelQuery}
            onChange={(event) => setSessionPanelQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search sessions"
          />
          <div className="pet-session-list">
            {filteredSessionPickerItems.length > 0 ? (
              filteredSessionPickerItems.map((item) => (
                <button
                  key={item.petSessionId}
                  type="button"
                  className="pet-session-row"
                  onClick={() => restoreSessionFromPanel(item.petSessionId)}
                >
                  <span className="pet-session-title">{item.title}</span>
                  <span className="pet-session-detail-grid" aria-label={item.subtitle}>
                    <span>{item.workspace}</span>
                    <span>{item.status}</span>
                    <span>{item.time}</span>
                  </span>
                  <span className="pet-session-preview">
                    <span className="pet-session-preview-label">Prompt</span>
                    <span>{item.promptPreview}</span>
                  </span>
                  <span className="pet-session-preview">
                    <span className="pet-session-preview-label">Summary</span>
                    <span>{item.summaryPreview}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="pet-session-empty">No sessions</div>
            )}
          </div>
        </section>
      ) : null}
      {promptPanelOpen ? (
        <section className="pet-panel pet-prompt-panel" aria-label="Codex prompt">
          <div className="pet-prompt-panel-header">
            <span>Prompt</span>
            <button
              type="button"
              className="pet-prompt-panel-close"
              aria-label="Close prompt"
              onClick={() => setPromptPanelOpen(false)}
            >
              x
            </button>
          </div>
          <textarea
            className="pet-prompt-input"
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder="Prompt"
            aria-label="Prompt"
            rows={4}
          />
          <div className="pet-prompt-actions">
            <button
              type="button"
              className="pet-prompt-button"
              onClick={() => setPromptPanelOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pet-prompt-button pet-prompt-button-primary"
              disabled={!promptDraft.trim()}
              onClick={sendPromptFromPanel}
            >
              Send
            </button>
          </div>
        </section>
      ) : null}
      {statusText ? (
        <div className="pet-status" role="status">
          <span className="pet-status-dot" />
          <span>{statusText}</span>
          {approvalFallback ? (
            <button
              type="button"
              className="pet-status-action"
              onClick={focusVscodeForApproval}
            >
              {approvalFallback.primaryAction.label}
            </button>
          ) : showApiRetry ? (
            <button
              type="button"
              className="pet-status-action"
              disabled={apiRuntimeRetrying}
              onClick={retryApiRuntime}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
