import { appState } from '../state.js';
import { createModalShell } from './modal-shell.js';

const STAR_THRESHOLD = 10;
const REPO_URL = 'https://github.com/elirantutia/vibeyard';

let cleanupFn: (() => void) | null = null;

function showStarPromptDialog(): void {
  cleanupFn?.();
  cleanupFn = null;

  const { overlay, body, actions } = createModalShell({
    id: 'star-prompt-overlay',
    title: 'Enjoying Vibeyard?',
  });
  body.innerHTML = '';
  actions.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'star-prompt-container';

  const icon = document.createElement('div');
  icon.className = 'star-prompt-icon';
  icon.textContent = '⭐';
  container.appendChild(icon);

  const message = document.createElement('div');
  message.className = 'star-prompt-message';
  message.textContent =
    "If Vibeyard has been useful to you, consider giving it a star on GitHub. It helps others discover the project!";
  container.appendChild(message);

  const innerActions = document.createElement('div');
  innerActions.className = 'star-prompt-actions';

  const starBtn = document.createElement('button');
  starBtn.className = 'btn-primary';
  starBtn.textContent = 'Star on GitHub';
  innerActions.appendChild(starBtn);

  const laterBtn = document.createElement('button');
  laterBtn.className = 'btn-secondary';
  laterBtn.textContent = 'Maybe Later';
  innerActions.appendChild(laterBtn);

  container.appendChild(innerActions);

  const dontAsk = document.createElement('button');
  dontAsk.className = 'star-prompt-dont-ask';
  dontAsk.textContent = "Don't ask again";
  container.appendChild(dontAsk);

  body.appendChild(container);

  overlay.style.display = '';

  const close = () => {
    overlay.style.display = 'none';
    cleanupFn?.();
    cleanupFn = null;
  };

  const handleStar = () => {
    window.vibeyard.app.openExternal(REPO_URL);
    appState.dismissStarPrompt();
    close();
  };

  const handleDontAsk = () => {
    appState.dismissStarPrompt();
    close();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  starBtn.addEventListener('click', handleStar);
  laterBtn.addEventListener('click', close);
  dontAsk.addEventListener('click', handleDontAsk);
  document.addEventListener('keydown', handleKeydown);

  cleanupFn = () => {
    starBtn.removeEventListener('click', handleStar);
    laterBtn.removeEventListener('click', close);
    dontAsk.removeEventListener('click', handleDontAsk);
    document.removeEventListener('keydown', handleKeydown);
  };
}

export function checkStarPrompt(): void {
  if (appState.starPromptDismissed) return;
  if (appState.appLaunchCount < STAR_THRESHOLD) return;
  showStarPromptDialog();
}
