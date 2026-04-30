"use client";

import type { FormEvent } from "react";

type TtsMode = "browser" | "server";

type CompanionCommandBarProps = {
  input: string;
  inputLabel: string;
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
  ttsMode: TtsMode;
  isAdvancedPanelOpen: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onInputChange: (value: string) => void;
  onTtsEnabledChange: (enabled: boolean) => void;
  onTtsModeChange: (mode: TtsMode) => void;
  onAdvancedToggle: () => void;
};

export function CompanionCommandBar({
  input,
  inputLabel,
  loading,
  error,
  ttsEnabled,
  ttsMode,
  isAdvancedPanelOpen,
  onSubmit,
  onInputChange,
  onTtsEnabledChange,
  onTtsModeChange,
  onAdvancedToggle,
}: CompanionCommandBarProps) {
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

            <button className="mio-send" type="submit" disabled={loading} aria-label={"\u53d1\u9001"}>
              <span className="mio-send-icon" aria-hidden="true">
                <svg viewBox="0 0 22 22" focusable="false" aria-hidden="true">
                  <path d="M2.5 3.8L19.2 11L2.5 18.2l3.1-5.85L11.8 11 5.6 9.65 2.5 3.8Z" />
                </svg>
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

      {error ? <p className="mio-error">{error}</p> : null}
    </form>
  );
}
