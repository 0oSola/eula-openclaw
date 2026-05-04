"use client";

import type { ReactNode } from "react";
import type { FormEvent } from "react";
import sendIcon1x from "../../../images/send/send_icon_fixed_1x.png";
import sendIcon2x from "../../../images/send/send_icon_fixed_2x.png";
import sendIcon3x from "../../../images/send/send_icon_fixed_3x.png";
import sendIcon4x from "../../../images/send/send_icon_fixed_4x.png";
import sendIconHover1x from "../../../images/send/send_icon_hover_1x.png";
import sendIconHover2x from "../../../images/send/send_icon_hover_2x.png";
import sendIconHover3x from "../../../images/send/send_icon_hover_3x.png";
import sendIconHover4x from "../../../images/send/send_icon_hover_4x.png";
import sendIconDisabled1x from "../../../images/send/send_icon_disabled_1x.png";
import sendIconDisabled2x from "../../../images/send/send_icon_disabled_2x.png";
import sendIconDisabled3x from "../../../images/send/send_icon_disabled_3x.png";
import sendIconDisabled4x from "../../../images/send/send_icon_disabled_4x.png";
import sendIconLoading1x from "../../../images/send/send_icon_loading_1x.png";
import sendIconLoading2x from "../../../images/send/send_icon_loading_2x.png";
import sendIconLoading3x from "../../../images/send/send_icon_loading_3x.png";
import sendIconLoading4x from "../../../images/send/send_icon_loading_4x.png";

type TtsMode = "browser" | "server";
type SendVisualState = "default" | "hover" | "disabled" | "loading";
type SendAsset = typeof sendIcon1x;
type SendAssetSet = readonly [SendAsset, SendAsset, SendAsset, SendAsset];

type CompanionCommandBarProps = {
  input: string;
  inputLabel: string;
  loading: boolean;
  sendDisabled: boolean;
  error: string;
  ttsEnabled: boolean;
  ttsMode: TtsMode;
  isAdvancedPanelOpen: boolean;
  advancedPanel?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onInputChange: (value: string) => void;
  onTtsEnabledChange: (enabled: boolean) => void;
  onTtsModeChange: (mode: TtsMode) => void;
  onAdvancedToggle: () => void;
};

const sendVisualAssets: Record<SendVisualState, SendAssetSet> = {
  default: [sendIcon1x, sendIcon2x, sendIcon3x, sendIcon4x],
  hover: [sendIconHover1x, sendIconHover2x, sendIconHover3x, sendIconHover4x],
  disabled: [sendIconDisabled1x, sendIconDisabled2x, sendIconDisabled3x, sendIconDisabled4x],
  loading: [sendIconLoading1x, sendIconLoading2x, sendIconLoading3x, sendIconLoading4x],
};

function SendStatePicture({ state }: { state: SendVisualState }) {
  const [asset1x, asset2x, asset3x, asset4x] = sendVisualAssets[state];

  return (
    <picture className="mio-send-art-picture">
      <source media="(min-resolution: 3.5dppx)" srcSet={asset4x.src} />
      <source media="(min-resolution: 2.5dppx)" srcSet={asset3x.src} />
      <source media="(min-resolution: 1.5dppx)" srcSet={asset2x.src} />
      <img className="mio-send-art" src={asset1x.src} alt="" aria-hidden="true" />
    </picture>
  );
}

export function CompanionCommandBar({
  input,
  inputLabel,
  loading,
  sendDisabled,
  error,
  ttsEnabled,
  ttsMode,
  isAdvancedPanelOpen,
  advancedPanel,
  onSubmit,
  onInputChange,
  onTtsEnabledChange,
  onTtsModeChange,
  onAdvancedToggle,
}: CompanionCommandBarProps) {
  const buttonDisabled = sendDisabled || loading;
  const sendState: SendVisualState = loading ? "loading" : sendDisabled ? "disabled" : "default";

  return (
    <form className="mio-command-bar" data-testid="mio-command-bar" onSubmit={onSubmit}>
      <div className="mio-command-shell">
        <div className="mio-command-surface" aria-hidden="true" />

        <div className="mio-command-left">
          <label className="mio-tts">
            <span className="mio-tts-glyph" aria-hidden="true">
              <svg viewBox="0 0 14 14" focusable="false" aria-hidden="true">
                <circle cx="7" cy="7" r="2" />
                <path d="M7 1.2v2.6M7 10.2v2.6M1.2 7h2.6M10.2 7h2.6" />
              </svg>
            </span>
            <span>TTS</span>
            <span className={`mio-tts-switch ${ttsEnabled ? "is-on" : ""}`} aria-hidden="true" />
            <input
              className="mio-tts-input"
              type="checkbox"
              checked={ttsEnabled}
              onChange={(event) => onTtsEnabledChange(event.target.checked)}
            />
          </label>

          <button className="mio-mic" type="button" aria-label={"\u8bed\u97f3\u8f93\u5165"}>
            <span className="mio-mic-icon" aria-hidden="true">
              <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
                <rect x="5" y="2.2" width="8" height="9.6" rx="4" ry="4" />
                <path d="M3 10.7c.35 2.5 2.61 4.35 6 4.35s5.65-1.85 6-4.35" />
                <path d="M9 14.9v2.1" />
              </svg>
            </span>
          </button>
        </div>

        <div className="mio-command-center">
          <div className="mio-command-input-shell">
            <div className="mio-command-copy-wrap">
              <input
                className="mio-command-input"
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder={inputLabel}
                aria-label={inputLabel}
              />
            </div>

            <button
              className="mio-send"
              type="submit"
              disabled={buttonDisabled}
              data-send-state={sendState}
              aria-label={loading ? "\u53d1\u9001\u4e2d" : "\u53d1\u9001"}
              aria-busy={loading || undefined}
            >
              <span className="mio-send-art-stack" aria-hidden="true">
                <span className="mio-send-art-layer mio-send-art-layer-default">
                  <SendStatePicture state="default" />
                </span>
                <span className="mio-send-art-layer mio-send-art-layer-hover">
                  <SendStatePicture state="hover" />
                </span>
                <span className="mio-send-art-layer mio-send-art-layer-disabled">
                  <SendStatePicture state="disabled" />
                </span>
                <span className="mio-send-art-layer mio-send-art-layer-loading">
                  <SendStatePicture state="loading" />
                </span>
              </span>
              <span className="mio-send-label">{loading ? "\u53d1\u9001\u4e2d" : "\u53d1\u9001"}</span>
            </button>
          </div>
        </div>

        <div className="mio-command-right">
          <label className="mio-mode mio-voice-mode">
            <span className="mio-eq-icon" aria-hidden="true">
              <svg viewBox="0 0 14 14" focusable="false" aria-hidden="true">
                <path d="M2 4v6M7 2v10M12 5v4" />
              </svg>
            </span>
            <span>{"\u8bed\u97f3\u6a21\u5f0f"}</span>
            <select value={ttsMode} onChange={(event) => onTtsModeChange(event.target.value as TtsMode)}>
              <option value="browser">browser</option>
              <option value="server">server</option>
            </select>
          </label>

          <button
            className={`mio-mode mio-advanced-mode ${isAdvancedPanelOpen ? "is-active" : ""}`}
            type="button"
            aria-expanded={isAdvancedPanelOpen}
            aria-controls="mio-advanced-panel"
            onClick={onAdvancedToggle}
          >
            <span className="mio-gear-icon" aria-hidden="true">
              <svg viewBox="0 0 14 14" focusable="false" aria-hidden="true">
                <circle cx="7" cy="7" r="3" />
                <path d="M7 1.3v1.8M7 10.9v1.8M1.3 7h1.8M10.9 7h1.8" />
              </svg>
            </span>
            <span>{"\u9ad8\u7ea7\u529f\u80fd"}</span>
          </button>
        </div>
      </div>

      {advancedPanel}
      {error ? <p className="mio-error">{error}</p> : null}
    </form>
  );
}
