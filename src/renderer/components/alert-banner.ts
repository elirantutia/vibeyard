import { appState } from '../state.js';

export interface AlertBannerConfig {
  className?: string;
  icon: string;
  message: string;
  cta?: { label: string; onClick: (btn: HTMLButtonElement) => void };
  onDismiss?: () => void;
}

let currentBanner: HTMLElement | null = null;
let bannerSessionId: string | null = null;
let sessionChangeCleanupAttached = false;

function attachSessionChangeCleanup(): void {
  if (sessionChangeCleanupAttached) return;
  sessionChangeCleanupAttached = true;
  appState.on('session-changed', () => {
    if (bannerSessionId && appState.activeSession?.id !== bannerSessionId) {
      removeAlertBanner();
    }
  });
}

export function showAlertBanner(config: AlertBannerConfig): void {
  removeAlertBanner();
  attachSessionChangeCleanup();

  const activeSession = appState.activeSession;
  if (!activeSession) return;

  const pane = document.querySelector(`.terminal-pane[data-session-id="${activeSession.id}"]`);
  if (!pane) return;
  bannerSessionId = activeSession.id;

  const banner = document.createElement('div');
  banner.className = `insight-alert${config.className ? ` ${config.className}` : ''}`;

  const icon = document.createElement('span');
  icon.className = 'insight-alert-icon';
  icon.textContent = config.icon;

  const message = document.createElement('span');
  message.className = 'insight-alert-message';
  message.textContent = config.message;

  banner.appendChild(icon);
  banner.appendChild(message);

  if (config.cta) {
    const ctaBtn = document.createElement('button');
    ctaBtn.className = 'insight-alert-cta';
    ctaBtn.textContent = config.cta.label;
    const onClick = config.cta.onClick;
    ctaBtn.addEventListener('click', () => onClick(ctaBtn));
    banner.appendChild(ctaBtn);
  }

  if (config.onDismiss) {
    const onDismiss = config.onDismiss;
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'insight-alert-dismiss';
    dismissBtn.textContent = "Don\u2019t show again";
    dismissBtn.addEventListener('click', () => {
      onDismiss();
      removeAlertBanner();
    });
    banner.appendChild(dismissBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'insight-alert-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => removeAlertBanner());

  banner.appendChild(closeBtn);

  const xtermWrap = pane.querySelector('.xterm-wrap');
  if (xtermWrap) {
    pane.insertBefore(banner, xtermWrap);
  } else {
    pane.prepend(banner);
  }

  banner.addEventListener('animationend', () => {
    banner.style.animation = 'none';
  }, { once: true });

  currentBanner = banner;
}

export function removeAlertBanner(): void {
  if (currentBanner) {
    currentBanner.remove();
    currentBanner = null;
    bannerSessionId = null;
  }
}
