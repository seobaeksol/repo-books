
import { BookOpen, Library, Palette, Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  colorInputValue,
  customThemeFields,
  getThemePreset,
  numericInputValue,
  themePresets,
  themeStyleFor,
  themeVariablesFor,
  type ThemeId,
  type ThemeOverrides,
  type ThemeVariable
} from "../design/themes";
import type { MobilePanel, StudioStatus } from "../types";
import { swatchStyle } from "../utils/appHelpers";

export function AppFrame({
  children,
  view,
  focusMode,
  mobilePanel,
  studioStatus,
  themeId,
  customThemeOverrides,
  onThemeChange,
  onCustomThemeChange,
  goToLibrary,
  goToGeneration,
  goToReader
}: {
  children: ReactNode;
  view: string;
  focusMode: boolean;
  mobilePanel: MobilePanel;
  studioStatus: StudioStatus;
  themeId: ThemeId;
  customThemeOverrides: ThemeOverrides;
  onThemeChange: (themeId: ThemeId) => void;
  onCustomThemeChange: (overrides: ThemeOverrides) => void;
  goToLibrary: () => void;
  goToGeneration: () => void;
  goToReader?: () => void;
}) {
  const location = useLocation();

  return (
    <div
      className="app-shell"
      data-view={view}
      data-focus={String(focusMode)}
      data-mobile-panel={mobilePanel}
      data-theme={themeId}
      style={themeStyleFor(themeId, customThemeOverrides) as CSSProperties}
    >
      <header className="top-bar command-surface" aria-label="앱 명령 막대">
        <button className="brand-mark" type="button" onClick={goToLibrary} aria-label="Repo Books 책장으로 이동">
          <span className="brand-icon" aria-hidden="true">
            <BookOpen />
          </span>
          <span className="brand-copy">
            <strong>Repo Books</strong>
            <small>Repository Bookshelf</small>
          </span>
        </button>
        <div className="top-actions">
          <ThemeMenu
            themeId={themeId}
            customThemeOverrides={customThemeOverrides}
            onThemeChange={onThemeChange}
            onCustomThemeChange={onCustomThemeChange}
          />
          <div className={`studio-status is-${studioStatus}`} aria-label={`LM Studio ${studioStatus}`}>
            <span className={`state-dot state-dot--${studioStatus}`} />
            <span>LM Studio</span>
            <strong>{studioStatus}</strong>
          </div>
        </div>
      </header>

      <main className="workspace" id="workspace" tabIndex={-1}>
        <div className="app-view">{children}</div>
      </main>

      <nav className="mobile-library-nav command-surface" aria-label="모바일 책장 탐색">
        <button
          className={`mobile-nav-button ${location.pathname.startsWith("/library") ? "active" : ""}`}
          type="button"
          onClick={goToLibrary}
          aria-current={location.pathname.startsWith("/library") ? "page" : undefined}
          aria-label="책장"
        >
          <Library />
          <span>책장</span>
        </button>
        <button
          className={`mobile-nav-button ${location.pathname.startsWith("/generation") ? "active" : ""}`}
          type="button"
          onClick={goToGeneration}
          aria-current={location.pathname.startsWith("/generation") ? "page" : undefined}
          aria-label="새 책"
        >
          <Plus />
          <span>새 책</span>
        </button>
        <button
          className={`mobile-nav-button ${location.pathname.startsWith("/books/") ? "active" : ""}`}
          type="button"
          onClick={goToReader}
          disabled={!goToReader}
          aria-current={location.pathname.startsWith("/books/") ? "page" : undefined}
          aria-label="읽기"
        >
          <BookOpen />
          <span>읽기</span>
        </button>
      </nav>
    </div>
  );
}

function ThemeMenu({
  themeId,
  customThemeOverrides,
  onThemeChange,
  onCustomThemeChange
}: {
  themeId: ThemeId;
  customThemeOverrides: ThemeOverrides;
  onThemeChange: (themeId: ThemeId) => void;
  onCustomThemeChange: (overrides: ThemeOverrides) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTheme = themeId === "custom" ? "Custom" : getThemePreset(themeId).label;
  const customVariables = themeVariablesFor("custom", customThemeOverrides);

  function selectTheme(nextThemeId: ThemeId) {
    onThemeChange(nextThemeId);
    setOpen(false);
  }

  function updateCustomVariable(variable: ThemeVariable, value: string) {
    const nextOverrides = { ...customThemeOverrides, [variable]: value };
    if (variable === "--app-bg") {
      nextOverrides["--app-bg-gradient"] = `linear-gradient(180deg, ${value}, ${value})`;
    }
    onCustomThemeChange(nextOverrides);
  }

  return (
    <div className="theme-menu-wrap">
      <button className="theme-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Palette />
        <span>테마</span>
        <strong>{activeTheme}</strong>
      </button>
      {open ? (
        <div className="theme-popover command-surface" role="dialog" aria-label="테마 설정">
          <div className="theme-options" role="radiogroup" aria-label="테마 선택">
            {themePresets.map((theme) => (
              <button
                key={theme.id}
                className="theme-option"
                type="button"
                role="radio"
                aria-checked={themeId === theme.id}
                onClick={() => selectTheme(theme.id)}
              >
                <span className="theme-swatch" style={swatchStyle(theme.variables)} />
                <span>
                  <strong>{theme.label}</strong>
                  <small>{theme.description}</small>
                </span>
              </button>
            ))}
            <button className="theme-option" type="button" role="radio" aria-checked={themeId === "custom"} onClick={() => onThemeChange("custom")}>
              <span className="theme-swatch" style={swatchStyle(customVariables)} />
              <span>
                <strong>Custom</strong>
                <small>사용자 정의</small>
              </span>
            </button>
          </div>

          <div className="theme-custom-grid" aria-label="사용자 정의 테마">
            {customThemeFields.map((field) => (
              <label key={field.variable}>
                <span>{field.label}</span>
                <input
                  type="color"
                  value={colorInputValue(customVariables[field.variable])}
                  onChange={(event) => updateCustomVariable(field.variable, event.target.value)}
                />
              </label>
            ))}
          </div>

          <label className="theme-range-row">
            <span>본문 크기</span>
            <input
              type="range"
              min="0.92"
              max="1.14"
              step="0.01"
              value={numericInputValue(customVariables["--reader-font-scale"], 1)}
              onChange={(event) => updateCustomVariable("--reader-font-scale", event.target.value)}
            />
          </label>
          <label className="theme-range-row">
            <span>줄 간격</span>
            <input
              type="range"
              min="1.55"
              max="2.1"
              step="0.05"
              value={numericInputValue(customVariables["--reader-line-height"], 1.85)}
              onChange={(event) => updateCustomVariable("--reader-line-height", event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
