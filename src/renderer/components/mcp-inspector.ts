import { renderSchemaForm, type JsonSchema } from './mcp-schema-form.js';

type NavTab = 'tools' | 'resources' | 'prompts';

interface McpInspectorInstance {
  element: HTMLElement;
  connected: boolean;
  url: string;
  activeTab: NavTab;
  toolsList: unknown[];
  resourcesList: unknown[];
  promptsList: unknown[];
}

const instances = new Map<string, McpInspectorInstance>();

export function createInspectorPane(sessionId: string): void {
  if (instances.has(sessionId)) return;

  const pane = document.createElement('div');
  pane.className = 'mcp-inspector-pane hidden';
  pane.dataset.sessionId = sessionId;

  pane.innerHTML = `
    <div class="mcp-inspector-header">
      <input class="mcp-url-input" type="text" placeholder="MCP server URL (e.g. http://localhost:3000/mcp)" />
      <button class="mcp-connect-btn">Connect</button>
      <span class="mcp-status disconnected"></span>
    </div>
    <div class="mcp-inspector-body">
      <div class="mcp-inspector-nav">
        <button class="mcp-nav-tab active" data-tab="tools">Tools <span class="mcp-nav-count">0</span></button>
        <button class="mcp-nav-tab" data-tab="resources">Resources <span class="mcp-nav-count">0</span></button>
        <button class="mcp-nav-tab" data-tab="prompts">Prompts <span class="mcp-nav-count">0</span></button>
      </div>
      <div class="mcp-inspector-content">
        <div class="mcp-empty-content">Connect to an MCP server to inspect its capabilities</div>
      </div>
    </div>
  `;

  const instance: McpInspectorInstance = {
    element: pane,
    connected: false,
    url: '',
    activeTab: 'tools',
    toolsList: [],
    resourcesList: [],
    promptsList: [],
  };
  instances.set(sessionId, instance);

  // Wire events
  const urlInput = pane.querySelector('.mcp-url-input') as HTMLInputElement;
  const connectBtn = pane.querySelector('.mcp-connect-btn') as HTMLButtonElement;
  const statusDot = pane.querySelector('.mcp-status') as HTMLElement;
  const navTabs = pane.querySelectorAll('.mcp-nav-tab');
  const content = pane.querySelector('.mcp-inspector-content') as HTMLElement;

  connectBtn.addEventListener('click', async () => {
    if (instance.connected) {
      await doDisconnect(sessionId, instance, connectBtn, statusDot, content);
    } else {
      const url = urlInput.value.trim();
      if (!url) return;
      await doConnect(sessionId, url, instance, connectBtn, statusDot, urlInput, content);
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !instance.connected) {
      connectBtn.click();
    }
  });

  for (const tab of navTabs) {
    tab.addEventListener('click', () => {
      instance.activeTab = (tab as HTMLElement).dataset.tab as NavTab;
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderContent(sessionId, instance, content);
    });
  }
}

async function doConnect(
  sessionId: string,
  url: string,
  instance: McpInspectorInstance,
  btn: HTMLButtonElement,
  dot: HTMLElement,
  urlInput: HTMLInputElement,
  content: HTMLElement,
): Promise<void> {
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  dot.className = 'mcp-status connecting';

  const result = await window.vibeyard.mcp.connect(sessionId, url);
  if (instances.get(sessionId) !== instance) return;
  if (result.success) {
    instance.connected = true;
    instance.url = url;
    btn.textContent = 'Disconnect';
    dot.className = 'mcp-status connected';
    urlInput.disabled = true;
    await refreshLists(sessionId, instance, content);
  } else {
    dot.className = 'mcp-status disconnected';
    btn.textContent = 'Connect';
    content.innerHTML = `<div class="mcp-error">Connection failed: ${esc(result.error || 'Unknown error')}</div>`;
  }
  btn.disabled = false;
}

async function doDisconnect(
  sessionId: string,
  instance: McpInspectorInstance,
  btn: HTMLButtonElement,
  dot: HTMLElement,
  content: HTMLElement,
): Promise<void> {
  await window.vibeyard.mcp.disconnect(sessionId);
  if (instances.get(sessionId) !== instance) return;
  instance.connected = false;
  instance.toolsList = [];
  instance.resourcesList = [];
  instance.promptsList = [];
  btn.textContent = 'Connect';
  dot.className = 'mcp-status disconnected';
  const urlInput = instance.element.querySelector('.mcp-url-input') as HTMLInputElement;
  urlInput.disabled = false;
  updateCounts(instance);
  content.innerHTML = '<div class="mcp-empty-content">Disconnected</div>';
}

async function refreshLists(sessionId: string, instance: McpInspectorInstance, content: HTMLElement): Promise<void> {
  const [tools, resources, prompts] = await Promise.all([
    window.vibeyard.mcp.listTools(sessionId),
    window.vibeyard.mcp.listResources(sessionId),
    window.vibeyard.mcp.listPrompts(sessionId),
  ]);

  instance.toolsList = tools.success ? (tools.data as unknown[]) : [];
  instance.resourcesList = resources.success ? (resources.data as unknown[]) : [];
  instance.promptsList = prompts.success ? (prompts.data as unknown[]) : [];

  updateCounts(instance);
  renderContent(sessionId, instance, content);
}

function updateCounts(instance: McpInspectorInstance): void {
  const counts = instance.element.querySelectorAll('.mcp-nav-count');
  counts[0].textContent = String(instance.toolsList.length);
  counts[1].textContent = String(instance.resourcesList.length);
  counts[2].textContent = String(instance.promptsList.length);
}

function renderContent(sessionId: string, instance: McpInspectorInstance, content: HTMLElement): void {
  content.innerHTML = '';

  if (!instance.connected) {
    content.innerHTML = '<div class="mcp-empty-content">Connect to an MCP server to inspect its capabilities</div>';
    return;
  }

  switch (instance.activeTab) {
    case 'tools':
      renderToolsList(sessionId, instance.toolsList, content);
      break;
    case 'resources':
      renderResourcesList(sessionId, instance.resourcesList, content);
      break;
    case 'prompts':
      renderPromptsList(sessionId, instance.promptsList, content);
      break;
  }
}

function renderToolsList(sessionId: string, tools: unknown[], container: HTMLElement): void {
  if (tools.length === 0) {
    container.innerHTML = '<div class="mcp-empty-content">No tools available</div>';
    return;
  }

  for (const tool of tools as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>) {
    const card = document.createElement('div');
    card.className = 'mcp-card';

    const header = document.createElement('div');
    header.className = 'mcp-card-header';
    header.innerHTML = `<span class="mcp-card-name">${esc(tool.name)}</span>`;
    if (tool.description) {
      header.innerHTML += `<span class="mcp-card-desc">${esc(tool.description)}</span>`;
    }

    const body = document.createElement('div');
    body.className = 'mcp-card-body hidden';

    let formRef: { getValues: () => Record<string, unknown> } | null = null;

    header.addEventListener('click', () => {
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden');
      if (!isOpen && body.children.length === 0) {
        // Build form
        if (tool.inputSchema && (tool.inputSchema as Record<string, unknown>).properties) {
          // SAFETY: MCP tool schemas are opaque JSON; renderSchemaForm only reads properties/required.
          const { element, getValues } = renderSchemaForm(tool.inputSchema as unknown as JsonSchema);
          formRef = { getValues };
          body.appendChild(element);
        }

        const execBtn = document.createElement('button');
        execBtn.className = 'mcp-exec-btn';
        execBtn.textContent = 'Execute';

        const resultPre = document.createElement('pre');
        resultPre.className = 'mcp-result hidden';

        execBtn.addEventListener('click', async () => {
          execBtn.disabled = true;
          execBtn.textContent = 'Executing...';
          resultPre.classList.remove('hidden');
          resultPre.textContent = 'Loading...';

          const args = formRef ? formRef.getValues() : {};
          const res = await window.vibeyard.mcp.callTool(sessionId, tool.name, args);
          resultPre.textContent = JSON.stringify(res.success ? res.data : { error: res.error }, null, 2);
          execBtn.disabled = false;
          execBtn.textContent = 'Execute';
        });

        body.appendChild(execBtn);
        body.appendChild(resultPre);
      }
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  }
}

function renderResourcesList(sessionId: string, resources: unknown[], container: HTMLElement): void {
  if (resources.length === 0) {
    container.innerHTML = '<div class="mcp-empty-content">No resources available</div>';
    return;
  }

  for (const resource of resources as Array<{ name: string; uri: string; description?: string }>) {
    const card = document.createElement('div');
    card.className = 'mcp-card';

    const header = document.createElement('div');
    header.className = 'mcp-card-header';
    header.innerHTML = `<span class="mcp-card-name">${esc(resource.name)}</span><span class="mcp-card-uri">${esc(resource.uri)}</span>`;
    if (resource.description) {
      header.innerHTML += `<span class="mcp-card-desc">${esc(resource.description)}</span>`;
    }

    const body = document.createElement('div');
    body.className = 'mcp-card-body hidden';

    header.addEventListener('click', async () => {
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden');
      if (!isOpen && body.children.length === 0) {
        const resultPre = document.createElement('pre');
        resultPre.className = 'mcp-result';
        resultPre.textContent = 'Loading...';
        body.appendChild(resultPre);

        const res = await window.vibeyard.mcp.readResource(sessionId, resource.uri);
        resultPre.textContent = JSON.stringify(res.success ? res.data : { error: res.error }, null, 2);
      }
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  }
}

function renderPromptsList(sessionId: string, prompts: unknown[], container: HTMLElement): void {
  if (prompts.length === 0) {
    container.innerHTML = '<div class="mcp-empty-content">No prompts available</div>';
    return;
  }

  for (const prompt of prompts as Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>) {
    const card = document.createElement('div');
    card.className = 'mcp-card';

    const header = document.createElement('div');
    header.className = 'mcp-card-header';
    header.innerHTML = `<span class="mcp-card-name">${esc(prompt.name)}</span>`;
    if (prompt.description) {
      header.innerHTML += `<span class="mcp-card-desc">${esc(prompt.description)}</span>`;
    }

    const body = document.createElement('div');
    body.className = 'mcp-card-body hidden';

    let argInputs: Map<string, HTMLInputElement> | null = null;

    header.addEventListener('click', () => {
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden');
      if (!isOpen && body.children.length === 0) {
        // Build argument inputs
        if (prompt.arguments && prompt.arguments.length > 0) {
          argInputs = new Map();
          const form = document.createElement('div');
          form.className = 'mcp-schema-form';
          for (const arg of prompt.arguments) {
            const field = document.createElement('div');
            field.className = 'mcp-form-field';
            const label = document.createElement('label');
            label.textContent = arg.name + (arg.required ? ' *' : '');
            if (arg.description) label.title = arg.description;
            field.appendChild(label);
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'mcp-form-input';
            if (arg.description) input.placeholder = arg.description;
            field.appendChild(input);
            form.appendChild(field);
            argInputs.set(arg.name, input);
          }
          body.appendChild(form);
        }

        const execBtn = document.createElement('button');
        execBtn.className = 'mcp-exec-btn';
        execBtn.textContent = 'Run';

        const resultPre = document.createElement('pre');
        resultPre.className = 'mcp-result hidden';

        execBtn.addEventListener('click', async () => {
          execBtn.disabled = true;
          execBtn.textContent = 'Running...';
          resultPre.classList.remove('hidden');
          resultPre.textContent = 'Loading...';

          const args: Record<string, string> = {};
          if (argInputs) {
            for (const [name, input] of argInputs) {
              if (input.value.trim()) args[name] = input.value.trim();
            }
          }
          const res = await window.vibeyard.mcp.getPrompt(sessionId, prompt.name, args);
          resultPre.textContent = JSON.stringify(res.success ? res.data : { error: res.error }, null, 2);
          execBtn.disabled = false;
          execBtn.textContent = 'Run';
        });

        body.appendChild(execBtn);
        body.appendChild(resultPre);
      }
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  }
}

export function destroyInspectorPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instances.delete(sessionId);
  instance.element.remove();
  // Request teardown even while a connect is still pending.
  void window.vibeyard.mcp.disconnect(sessionId);
}

export function showInspectorPane(sessionId: string, split: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  if (split) {
    instance.element.classList.add('split');
  } else {
    instance.element.classList.remove('split');
  }
}

export function hideInspectorPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.add('hidden');
}

export function hideAllInspectorPanes(): void {
  for (const instance of instances.values()) {
    instance.element.classList.add('hidden');
  }
}

export function attachInspectorToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function getInspectorInstance(sessionId: string): McpInspectorInstance | undefined {
  return instances.get(sessionId);
}

export async function disconnectInspector(sessionId: string): Promise<void> {
  const instance = instances.get(sessionId);
  if (!instance) return;
  // Request teardown even while a connect is still pending.
  await window.vibeyard.mcp.disconnect(sessionId);
  instance.connected = false;
}

function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}
