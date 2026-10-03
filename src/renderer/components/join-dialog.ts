// Join dialog — guest-side UI for joining a shared P2P session.

import { joinRemoteSession } from '../sharing/share-manager.js';
import { appState } from '../state.js';
import { DecryptionError, validateShareKey } from '../sharing/share-crypto.js';
import { bindModalDismiss } from './modal-manager.js';

let activeOverlay: HTMLElement | null = null;
let activeDismiss: (() => void) | null = null;

export function showJoinDialog(): void {
  closeJoinDialog();

  const project = appState.activeProject;
  if (!project) return;

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  activeOverlay = overlay;

  const dialog = document.createElement('div');
  dialog.className = 'share-dialog';

  // Title
  const title = document.createElement('h3');
  title.textContent = 'Join Remote Session';
  dialog.appendChild(title);

  // Offer input section (share key + code paste together)
  const offerSection = document.createElement('div');
  offerSection.className = 'share-section';

  const pinLabel = document.createElement('div');
  pinLabel.className = 'share-label';
  pinLabel.textContent = 'Enter the share key from the host';
  offerSection.appendChild(pinLabel);

  const pinInput = document.createElement('input');
  pinInput.className = 'share-pin-input';
  pinInput.autocomplete = 'off';
  pinInput.placeholder = '32-character share key';
  offerSection.appendChild(pinInput);

  const offerLabel = document.createElement('div');
  offerLabel.className = 'share-label share-label-spaced';
  offerLabel.textContent = 'Paste the host\'s connection code';
  offerSection.appendChild(offerLabel);

  const offerTextarea = document.createElement('textarea');
  offerTextarea.className = 'share-code';
  offerTextarea.rows = 3;
  offerTextarea.placeholder = 'Paste connection code here...';
  offerSection.appendChild(offerTextarea);
  dialog.appendChild(offerSection);

  // Status area
  const statusEl = document.createElement('div');
  statusEl.className = 'share-status';
  dialog.appendChild(statusEl);

  // Answer section (hidden initially)
  const answerSection = document.createElement('div');
  answerSection.className = 'share-section hidden';

  const answerLabel = document.createElement('div');
  answerLabel.className = 'share-label';
  answerLabel.textContent = 'Send this response code back to the host';
  answerSection.appendChild(answerLabel);

  const answerTextarea = document.createElement('textarea');
  answerTextarea.className = 'share-code';
  answerTextarea.readOnly = true;
  answerTextarea.rows = 3;
  answerSection.appendChild(answerTextarea);

  const copyAnswerBtn = document.createElement('button');
  copyAnswerBtn.className = 'btn-secondary share-btn';
  copyAnswerBtn.textContent = 'Copy Response';
  copyAnswerBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(answerTextarea.value);
    copyAnswerBtn.textContent = 'Copied!';
    setTimeout(() => { copyAnswerBtn.textContent = 'Copy Response'; }, 1500);
  });
  answerSection.appendChild(copyAnswerBtn);
  dialog.appendChild(answerSection);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'share-actions';

  const joinBtn = document.createElement('button');
  joinBtn.className = 'btn-primary share-btn';
  joinBtn.textContent = 'Join';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-secondary share-btn';
  closeBtn.textContent = 'Cancel';
  closeBtn.addEventListener('click', closeJoinDialog);

  actions.appendChild(closeBtn);
  actions.appendChild(joinBtn);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // ESC + overlay background click close the dialog (capture-phase ESC so it
  // works over a focused terminal and never leaks to the PTY).
  activeDismiss = bindModalDismiss({ overlay, onClose: closeJoinDialog });

  // Join flow
  joinBtn.addEventListener('click', async () => {
    const pin = pinInput.value.trim();
    const pinError = validateShareKey(pin);
    if (pinError) {
      statusEl.textContent = pinError;
      return;
    }
    const offer = offerTextarea.value.trim();
    if (!offer) {
      statusEl.textContent = 'Please paste the connection code from the host.';
      return;
    }

    joinBtn.disabled = true;
    joinBtn.textContent = 'Connecting...';
    statusEl.textContent = 'Generating response code...';
    offerTextarea.readOnly = true;
    pinInput.readOnly = true;

    try {
      const { answer } = await joinRemoteSession(project.id, offer, pin, closeJoinDialog);

      answerTextarea.value = answer;
      answerSection.classList.remove('hidden');
      statusEl.textContent = 'Send the response code to the host. The session will appear once they connect.';

      closeBtn.textContent = 'Close';
    } catch (err) {
      if (err instanceof DecryptionError) {
        statusEl.textContent = 'Could not decrypt connection code. Check the share key and try again.';
      } else {
        statusEl.textContent = `Error: ${err instanceof Error ? err.message : 'Invalid code'}`;
      }
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join';
      offerTextarea.readOnly = false;
      pinInput.readOnly = false;
    }
  });
}

export function closeJoinDialog(): void {
  if (activeDismiss) {
    activeDismiss();
    activeDismiss = null;
  }
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}
