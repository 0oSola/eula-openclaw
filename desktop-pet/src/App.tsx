import { useCallback, useEffect, useMemo, useState } from "react";

import { MMDStage } from "@/features/stage/MMDStage";
import type { CompanionSharedConfig, MmdModelAsset, RenderPipeline, VmdAsset } from "@/lib/types";

import { createApiClient } from "./lib/apiClient";
import { describeMenuActionResult } from "./menu/menuActionStatus";
import { pickSelectedModel, selectFavoriteVmdUrls } from "./mmd/petStageState";

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
type DesktopPetMenuAction =
  | { type: "new-session" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions" }
  | { type: "notification-detail"; profile: NotificationProfile }
  | { type: "menu-language"; language: MenuLanguage }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" };

function getModelLabel(model: MmdModelAsset): string {
  if (model.label?.trim()) return model.label.trim();
  const parts = model.relative_path.split(/[\\/]/).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return model.name.replace(/\.(pmx|pmd)$/i, "") || "MMD Model";
}

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:8000");
  const [sharedConfig, setSharedConfig] = useState<CompanionSharedConfig>(DEFAULT_SHARED_CONFIG);
  const [models, setModels] = useState<MmdModelAsset[]>([]);
  const [vmdAssets, setVmdAssets] = useState<VmdAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [interactionMode, setInteractionMode] = useState<PetInteractionMode>("window-drag");
  const [notificationProfile, setNotificationProfile] = useState<NotificationProfile>("medium");
  const [menuStatus, setMenuStatus] = useState<string | null>(null);

  useEffect(() => {
    window.desktopPet
      ?.runtimeInfo()
      .then((info) => setApiBaseUrl(info.apiBaseUrl))
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

  const api = useMemo(() => createApiClient({ baseUrl: apiBaseUrl, userId: DEFAULT_USER_ID }), [apiBaseUrl]);
  const selectedModel = pickSelectedModel(models, sharedConfig.selected_model_path);
  const favoriteVmdUrls = selectedModel ? selectFavoriteVmdUrls(vmdAssets, selectedModel.relative_path) : [];
  const interaction = useMemo(
    () => ({
      emotion: "neutral",
      action: "idle",
      mode: favoriteVmdUrls.length > 0 ? ("vmd" as const) : ("procedural" as const),
      vmdLoopUrls: favoriteVmdUrls.map((url) => api.toAbsoluteUrl(url)),
      loopMode: "random" as const,
      loopGapMs: 600,
    }),
    [api, favoriteVmdUrls],
  );

  const loadPetState = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([api.getSharedConfig(), api.listModels(), api.listVmdAssets()])
      .then(([nextSharedConfig, nextModels, nextVmdAssets]) => {
        if (cancelled) return;
        setSharedConfig(nextSharedConfig);
        setModels(nextModels);
        setVmdAssets(nextVmdAssets);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setLoadError(error.message);
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
    return window.desktopPet?.menu?.onAction((action: DesktopPetMenuAction) => {
      setMenuStatus(describeMenuActionResult(action));
      if (action.type === "notification-detail") {
        setNotificationProfile(action.profile);
      }
      if (action.type === "sync-main-site") {
        loadPetState();
      }
      window.setTimeout(() => setMenuStatus(null), 2800);
    });
  }, [loadPetState]);

  const renderPipeline: RenderPipeline = sharedConfig.render_pipeline || "classic";

  return (
    <main className="pet-shell" data-interaction-mode={interactionMode}>
      <div className="pet-stage" data-render-pipeline={renderPipeline}>
        {selectedModel ? (
          <MMDStage
            chrome="bare"
            interaction={interaction}
            speaking={false}
            models={models}
            selectedModelPath={selectedModel.relative_path}
            modelUrl={api.toAbsoluteUrl(selectedModel.url)}
            modelLabel={getModelLabel(selectedModel)}
            renderPipeline={renderPipeline}
            cameraSnapshot={null}
            onModelChange={() => {}}
          />
        ) : null}
      </div>
      {menuStatus || loading || loadError || !selectedModel ? (
        <div className="pet-status" role="status">
          <span className="pet-status-dot" />
          <span>
            {menuStatus ||
              (loadError ? "API unavailable" : loading ? "Loading MMD" : `No MMD model · ${notificationProfile}`)}
          </span>
        </div>
      ) : null}
    </main>
  );
}
