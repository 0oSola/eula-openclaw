"use client";

import type { ReactNode } from "react";
import type { FormEvent } from "react";
import sendCut from "../../../images/send.png";
import voiceIcon1x from "../../../images/voice/voice_icon_fixed_1x.png";
import voiceIcon2x from "../../../images/voice/voice_icon_fixed_2x.png";
import voiceIcon3x from "../../../images/voice/voice_icon_fixed_3x.png";
import voiceIcon4x from "../../../images/voice/voice_icon_fixed_4x.png";
import voiceIconHover1x from "../../../images/voice/voice_icon_hover_1x.png";
import voiceIconHover2x from "../../../images/voice/voice_icon_hover_2x.png";
import voiceIconHover3x from "../../../images/voice/voice_icon_hover_3x.png";
import voiceIconHover4x from "../../../images/voice/voice_icon_hover_4x.png";

type SendVisualState = "default" | "hover" | "disabled" | "loading";
type VisualAsset = typeof voiceIcon1x;
type VisualAssetSet = readonly [VisualAsset, VisualAsset, VisualAsset, VisualAsset];
type VoiceVisualState = "default" | "hover";

type CompanionCommandBarProps = {
  input: string;
  inputLabel: string;
  loading: boolean;
  sendDisabled: boolean;
  error: string;
  ttsEnabled: boolean;
  isAdvancedPanelOpen: boolean;
  advancedPanel?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onInputChange: (value: string) => void;
  onTtsEnabledChange: (enabled: boolean) => void;
  onAdvancedToggle: () => void;
};

const voiceVisualAssets: Record<VoiceVisualState, VisualAssetSet> = {
  default: [voiceIcon1x, voiceIcon2x, voiceIcon3x, voiceIcon4x],
  hover: [voiceIconHover1x, voiceIconHover2x, voiceIconHover3x, voiceIconHover4x],
};

function VoiceButtonPicture({ state }: { state: VoiceVisualState }) {
  const [asset1x, asset2x, asset3x, asset4x] = voiceVisualAssets[state];

  return (
    <picture className="mio-voice-button-picture">
      <source media="(min-resolution: 3.5dppx)" srcSet={asset4x.src} />
      <source media="(min-resolution: 2.5dppx)" srcSet={asset3x.src} />
      <source media="(min-resolution: 1.5dppx)" srcSet={asset2x.src} />
      <img className="mio-voice-button-image" src={asset1x.src} alt="" aria-hidden="true" />
    </picture>
  );
}

function VoiceButton() {
  return (
    <button className="mio-voice-button" type="button" aria-label={"\u8bed\u97f3\u8f93\u5165"}>
      <span className="mio-voice-button-layer mio-voice-button-layer-default" aria-hidden="true">
        <VoiceButtonPicture state="default" />
      </span>
      <span className="mio-voice-button-layer mio-voice-button-layer-hover" aria-hidden="true">
        <VoiceButtonPicture state="hover" />
      </span>
    </button>
  );
}

function SendButton({ loading, disabled, state }: { loading: boolean; disabled: boolean; state: SendVisualState }) {
  return (
    <button
      className="mio-send"
      type="submit"
      disabled={disabled}
      data-send-state={state}
      aria-label={loading ? "\u53d1\u9001\u4e2d" : "\u53d1\u9001"}
      aria-busy={loading || undefined}
    >
      <img className="mio-send-cut" src={sendCut.src} alt="" aria-hidden="true" />
      <span className="mio-send-label">{loading ? "\u53d1\u9001\u4e2d" : "\u53d1\u9001"}</span>
    </button>
  );
}

export function CompanionCommandBar({
  input,
  inputLabel,
  loading,
  sendDisabled,
  error,
  ttsEnabled,
  isAdvancedPanelOpen,
  advancedPanel,
  onSubmit,
  onInputChange,
  onTtsEnabledChange,
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

          <VoiceButton />
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

            <SendButton loading={loading} disabled={buttonDisabled} state={sendState} />
          </div>
        </div>

        <div className="mio-command-right">
          <button
            className={`mio-mode mio-voice-mode ${ttsEnabled ? "is-active" : "is-muted"}`}
            type="button"
            aria-pressed={ttsEnabled}
            onClick={() => onTtsEnabledChange(!ttsEnabled)}
          >
            <span className="mio-eq-icon" aria-hidden="true">
              <svg viewBox="0 0 14 14" focusable="false" aria-hidden="true">
                <path d="M2 4v6M7 2v10M12 5v4" />
              </svg>
            </span>
            <span>{"\u8bed\u97f3\u6a21\u5f0f"}</span>
            <strong className="mio-voice-mode-state">{ttsEnabled ? "ON" : "OFF"}</strong>
          </button>

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
