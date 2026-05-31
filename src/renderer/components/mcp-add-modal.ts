import { appState } from '../state.js';

let cleanupFn: (() => void) | null = null;
let onAddedFn: (() => void) | null = null;

function getOverlay(): HTMLElement {
  let overlay = document.getElementById('mcp-add-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'mcp-add-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="modal-box mcp-add-box">
      <div class="modal-title">Add MCP Server</div>
      <div id="mcp-add-body" class="modal-body mcp-add-body"></div>
      <div class="modal-actions">
        <button id="mcp-add-cancel" class="btn-secondary">Cancel</button>
        <button id="mcp-add-confirm" class="btn-primary">Add</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function renderTypeFields(type: 'stdio' | 'sse'): string {
  if (type === 'stdio') {
    return `
      <div class="modal-field">
        <label for="mcp-add-command">Command</label>
        <input id="mcp-add-command" type="text" placeholder="e.g. npx" />
      </div>
      <div class="modal-field">
        <label for="mcp-add-args">Arguments</label>
        <input id="mcp-add-args" type="text" placeholder="e.g. -y @modelcontextprotocol/server-github" />
      </div>`;
  }
  return `
    <div class="modal-field">
      <label for="mcp-add-url">URL</label>
      <input id="mcp-add-url" type="text" placeholder="e.g. http://localhost:3000/sse" />
    </div>`;
}

function rebuildTypeFields(overlay: HTMLElement): void {
  const type = (overlay.querySelector('input[name="mcp-add-type"]:checked') as HTMLInputElement).value as 'stdio' | 'sse';
  const container = overlay.querySelector('#mcp-add-type-fields')!;
  container.innerHTML = renderTypeFields(type);
}

export function showMcpAddModal(onAdded: () => void): void {
  cleanupFn?.();
  cleanupFn = null;

  onAddedFn = onAdded;
  const overlay = getOverlay();
  const body = overlay.querySelector('#mcp-add-body')!;

  body.innerHTML = `
    <div class="modal-field">
      <label for="mcp-add-name">Name</label>
      <input id="mcp-add-name" type="text" placeholder="e.g. github" />
    </div>
    <div class="modal-field">
      <label>Type</label>
      <div class="mcp-add-type-row">
        <label class="mcp-add-radio"><input type="radio" name="mcp-add-type" value="stdio" checked /> stdio (command)</label>
        <label class="mcp-add-radio"><input type="radio" name="mcp-add-type" value="sse" /> sse (URL)</label>
      </div>
    </div>
    <div id="mcp-add-type-fields">${renderTypeFields('stdio')}</div>
    <div class="modal-field">
      <label for="mcp-add-env">Environment Variables <span class="mcp-add-hint">(optional, KEY=VALUE per line)</span></label>
      <textarea id="mcp-add-env" class="mcp-add-env-textarea" rows="3" placeholder="GITHUB_TOKEN=ghp_..."></textarea>
    </div>
    <div class="modal-field">
      <label>Scope</label>
      <div class="mcp-add-type-row">
        <label class="mcp-add-radio"><input type="radio" name="mcp-add-scope" value="user" checked /> User (global)</label>
        <label class="mcp-add-radio"><input type="radio" name="mcp-add-scope" value="project" /> Project</label>
      </div>
    </div>
    <div id="mcp-add-error" class="modal-error" style="display:none"></div>`;

  body.querySelectorAll('input[name="mcp-add-type"]').forEach(r =>
    r.addEventListener('change', () => rebuildTypeFields(overlay)),
  );

  overlay.style.display = '';
  requestAnimationFrame(() => (overlay.querySelector('#mcp-add-name') as HTMLInputElement).focus());

  const cancel = overlay.querySelector('#mcp-add-cancel')!;
  const confirm = overlay.querySelector('#mcp-add-confirm')!;

  const handleCancel = () => closeMcpAddModal();
  const handleConfirm = () => submit(overlay);
  const handleKeydown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') { ke.preventDefault(); closeMcpAddModal(); }
    else if (ke.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { ke.preventDefault(); submit(overlay); }
  };

  cancel.addEventListener('click', handleCancel);
  confirm.addEventListener('click', handleConfirm);
  overlay.addEventListener('keydown', handleKeydown);

  cleanupFn = () => {
    cancel.removeEventListener('click', handleCancel);
    confirm.removeEventListener('click', handleConfirm);
    overlay.removeEventListener('keydown', handleKeydown);
  };
}

function showError(overlay: HTMLElement, msg: string): void {
  const el = overlay.querySelector('#mcp-add-error') as HTMLElement;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

async function submit(overlay: HTMLElement): Promise<void> {
  const name = (overlay.querySelector('#mcp-add-name') as HTMLInputElement).value.trim();
  if (!name) { showError(overlay, 'Name is required'); return; }

  const type = (overlay.querySelector('input[name="mcp-add-type"]:checked') as HTMLInputElement).value;
  const scope = (overlay.querySelector('input[name="mcp-add-scope"]:checked') as HTMLInputElement).value as 'user' | 'project';

  let config: Record<string, unknown>;

  if (type === 'stdio') {
    const command = (overlay.querySelector('#mcp-add-command') as HTMLInputElement).value.trim();
    if (!command) { showError(overlay, 'Command is required'); return; }
    const argsStr = (overlay.querySelector('#mcp-add-args') as HTMLInputElement).value.trim();
    config = { command, args: argsStr ? argsStr.split(/\s+/) : [] };
  } else {
    const url = (overlay.querySelector('#mcp-add-url') as HTMLInputElement).value.trim();
    if (!url) { showError(overlay, 'URL is required'); return; }
    config = { url };
  }

  const envText = (overlay.querySelector('#mcp-add-env') as HTMLTextAreaElement).value.trim();
  if (envText) {
    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) { showError(overlay, `Invalid env var: ${trimmed}`); return; }
      env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
    if (Object.keys(env).length > 0) config.env = env;
  }

  const projectPath = scope === 'project' ? appState.activeProject?.path : undefined;
  if (scope === 'project' && !projectPath) {
    showError(overlay, 'No active project for project scope');
    return;
  }

  const result = await window.vibeyard.mcp.addServer(name, config, scope, projectPath);
  if (!result.success) {
    showError(overlay, result.error || 'Failed to add server');
    return;
  }

  closeMcpAddModal();
  onAddedFn?.();
}

export function closeMcpAddModal(): void {
  const overlay = document.getElementById('mcp-add-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  cleanupFn?.();
  cleanupFn = null;
}
