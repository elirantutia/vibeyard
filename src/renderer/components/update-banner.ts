export function initUpdateBanner(): void {
  const mainArea = document.getElementById('main-area');
  if (!mainArea) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'hidden';
  mainArea.prepend(banner);

  const messageSpan = document.createElement('span');
  messageSpan.className = 'update-banner-message';
  banner.appendChild(messageSpan);

  const actionBtn = document.createElement('button');
  actionBtn.className = 'update-banner-btn hidden';
  banner.appendChild(actionBtn);

  function show(msg: string, btn?: { label: string; action: () => void }, autoHideMs?: number): void {
    messageSpan.textContent = msg;
    banner.classList.remove('hidden');

    if (btn) {
      actionBtn.textContent = btn.label;
      actionBtn.onclick = btn.action;
      actionBtn.classList.remove('hidden');
    } else {
      actionBtn.classList.add('hidden');
    }

    if (autoHideMs) {
      setTimeout(() => banner.classList.add('hidden'), autoHideMs);
    }
  }

  let latestVersion = '';

  window.claudeIde.update.onAvailable((info) => {
    latestVersion = info.version;
    show(`Downloading update v${info.version}...`);
  });

  window.claudeIde.update.onDownloadProgress((info) => {
    const label = latestVersion ? `v${latestVersion}` : 'update';
    show(`Downloading ${label}... ${info.percent}%`);
  });

  window.claudeIde.update.onDownloaded((info) => {
    show(`Update v${info.version} ready.`, {
      label: 'Restart',
      action: () => window.claudeIde.update.install(),
    });
  });

  window.claudeIde.update.onError((info) => {
    show('Update check failed.', {
      label: 'Dismiss',
      action: () => banner.classList.add('hidden'),
    }, 10_000);
  });
}
