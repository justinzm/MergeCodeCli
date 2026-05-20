import React from "react";
import claudeIcon from "../assets/provider-icons/claude.png";
import codexIcon from "../assets/provider-icons/codex.png";
import geminiIcon from "../assets/provider-icons/gemini.png";

function mergeClassName(...classes) {
  return classes.filter(Boolean).join(" ");
}

const PROVIDER_META = {
  claude: { title: "Claude Code", icon: claudeIcon },
  codex: { title: "Codex CLI", icon: codexIcon },
  gemini: { title: "Gemini CLI", icon: geminiIcon }
};

export function ProviderIcon({
  provider = "claude",
  className = "",
  variant = "default",
  size = 14,
  ...rest
}) {
  const key = PROVIDER_META[provider] ? provider : "claude";
  const style = { width: size, height: size };
  const imageStyle = variant === "muted"
    ? { filter: "grayscale(1) saturate(0.15) brightness(1.1)", opacity: 0.88 }
    : undefined;
  const mergedStyle = imageStyle ? { ...style, ...imageStyle } : style;
  const providerClassName = `provider-icon-${key}`;

  return (
    <img
      src={PROVIDER_META[key].icon}
      alt=""
      aria-hidden="true"
      draggable="false"
      className={mergeClassName("icon provider-icon", providerClassName, className)}
      style={mergedStyle}
      title={PROVIDER_META[key].title}
      role="presentation"
      loading="lazy"
      decoding="async"
      {...rest}
    />
  );
}

export function ArchiveIcon({ className = "", size = 12 }) {
  return (
    <svg
      className={mergeClassName("icon archive-icon", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 6.5V12.5C3.5 13.05 3.95 13.5 4.5 13.5H11.5C12.05 13.5 12.5 13.05 12.5 12.5V6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 9H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SkillExtractIcon({ className = "", size = 14 }) {
  return (
    <svg
      className={mergeClassName("icon skill-extract-icon", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8.2 1.8L8.85 3.65L10.7 4.3L8.85 4.95L8.2 6.8L7.55 4.95L5.7 4.3L7.55 3.65L8.2 1.8Z"
        fill="currentColor"
      />
      <path
        d="M4.35 7.2L4.85 8.65L6.3 9.15L4.85 9.65L4.35 11.1L3.85 9.65L2.4 9.15L3.85 8.65L4.35 7.2Z"
        fill="currentColor"
      />
      <path
        d="M10.1 7.1L10.95 8.05C11.35 8.49 11.97 8.65 12.53 8.45L13.1 8.24L12.89 8.81C12.69 9.37 12.85 9.99 13.29 10.39L14.24 11.24L13.03 11.43C12.46 11.52 11.98 11.91 11.76 12.44L11.3 13.55L10.84 12.44C10.62 11.91 10.14 11.52 9.57 11.43L8.36 11.24L9.31 10.39C9.75 9.99 9.91 9.37 9.71 8.81L9.5 8.24L10.07 8.45C10.63 8.65 11.25 8.49 11.65 8.05L12.5 7.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SmartAiIcon({ className = "", size = 14 }) {
  return (
    <svg
      className={mergeClassName("icon smart-ai-icon", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 3.1C5.92 3.1 4.25 4.77 4.25 6.85V8.05C4.25 8.87 3.92 9.65 3.34 10.23L3.1 10.47C2.88 10.69 3.03 11.06 3.34 11.06H12.66C12.97 11.06 13.12 10.69 12.9 10.47L12.66 10.23C12.08 9.65 11.75 8.87 11.75 8.05V6.85C11.75 4.77 10.08 3.1 8 3.1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M6.45 11.1C6.62 11.81 7.26 12.3 8 12.3C8.74 12.3 9.38 11.81 9.55 11.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6.65" cy="7.15" r="0.72" fill="currentColor" />
      <circle cx="9.35" cy="7.15" r="0.72" fill="currentColor" />
      <path d="M12.8 2.3L13.15 3.3L14.15 3.65L13.15 4L12.8 5L12.45 4L11.45 3.65L12.45 3.3L12.8 2.3Z" fill="currentColor" />
      <path d="M2.9 2.95L3.12 3.58L3.75 3.8L3.12 4.02L2.9 4.65L2.68 4.02L2.05 3.8L2.68 3.58L2.9 2.95Z" fill="currentColor" />
    </svg>
  );
}

export function ExplorerToggleIcon({ className = "", size = 16 }) {
  return (
    <svg
      className={mergeClassName("icon explorer-toggle-icon", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1.75" y="2" width="12.5" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 2.7V13.3" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function ExternalLinkIcon({ className = "", size = 16 }) {
  return (
    <svg
      className={mergeClassName("icon external-link-icon", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M6.25 4.25H4.2C3.54 4.25 3 4.79 3 5.45V11.8C3 12.46 3.54 13 4.2 13H10.55C11.21 13 11.75 12.46 11.75 11.8V9.75" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.25 3H13V7.75" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 8.5L12.65 3.35" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon({ className = "", size = 14 }) {
  return (
    <svg
      className={mergeClassName("icon settings-icon", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.55 2.15C6.74 1.45 7.73 1.45 7.92 2.15L8.15 3C8.92 3.16 9.63 3.46 10.25 3.88L10.99 3.48C11.63 3.13 12.32 3.82 11.97 4.46L11.57 5.2C11.99 5.82 12.29 6.53 12.45 7.3L13.3 7.53C14 7.72 14 8.71 13.3 8.9L12.45 9.13C12.29 9.9 11.99 10.61 11.57 11.23L11.97 11.97C12.32 12.61 11.63 13.3 10.99 12.95L10.25 12.55C9.63 12.97 8.92 13.27 8.15 13.43L7.92 14.28C7.73 14.98 6.74 14.98 6.55 14.28L6.32 13.43C5.55 13.27 4.84 12.97 4.22 12.55L3.48 12.95C2.84 13.3 2.15 12.61 2.5 11.97L2.9 11.23C2.48 10.61 2.18 9.9 2.02 9.13L1.17 8.9C0.47 8.71 0.47 7.72 1.17 7.53L2.02 7.3C2.18 6.53 2.48 5.82 2.9 5.2L2.5 4.46C2.15 3.82 2.84 3.13 3.48 3.48L4.22 3.88C4.84 3.46 5.55 3.16 6.32 3L6.55 2.15Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="7.24" cy="8.22" r="2.05" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function MousePointerIcon({ className = "", size = 14 }) {
  return (
    <svg
      className={mergeClassName("icon mouse-pointer-icon", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3 2.2V11.8C3 12.18 3.4 12.42 3.72 12.24L6.5 10.68L8 13.55C8.2 13.93 8.67 14.08 9.05 13.88L10.22 13.26C10.6 13.06 10.75 12.59 10.55 12.21L9.04 9.34H12.1C12.51 9.34 12.73 8.86 12.47 8.54L3.98 2.01C3.58 1.7 3 1.99 3 2.49V2.2Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}
