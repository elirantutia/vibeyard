import { appState } from '../../state.js';
import { esc } from '../../dom-utils.js';
import { getGitStatus, getActiveGitPath, refreshGitStatus } from '../../git-status.js';
import { showModal, closeModal, setModalError } from '../modal.js';
import { hideTabContextMenu, getActiveContextMenu, setActiveContextMenu, positionMenu } from './menu.js';
import { gitStatusEl } from './dom.js';

export function renderGitStatus(): void {
  const project = appState.activeProject;
  if (!project) {
    gitStatusEl.innerHTML = '';
    return;
  }

  const status = getGitStatus(project.id);
  if (!status || !status.isGitRepo) {
    gitStatusEl.innerHTML = '';
    return;
  }

  const parts: string[] = [];

  if (status.branch) {
    parts.push(`<span class="git-branch">⎇ ${esc(status.branch)}</span>`);
  }

  const ab: string[] = [];
  if (status.ahead > 0) ab.push(`↑${status.ahead}`);
  if (status.behind > 0) ab.push(`↓${status.behind}`);
  if (ab.length) {
    parts.push(`<span class="git-ahead-behind">${ab.join(' ')}</span>`);
  }

  if (status.staged > 0) parts.push(`<span class="git-staged">+${status.staged}</span>`);
  if (status.modified > 0) parts.push(`<span class="git-modified">~${status.modified}</span>`);
  if (status.untracked > 0) parts.push(`<span class="git-untracked">?${status.untracked}</span>`);
  if (status.conflicted > 0) parts.push(`<span class="git-conflicted">!${status.conflicted}</span>`);

  gitStatusEl.innerHTML = parts.join(' ');
}

export async function showBranchContextMenu(e: MouseEvent): Promise<void> {
  e.stopPropagation();
  hideTabContextMenu();

  const project = appState.activeProject;
  if (!project) return;

  const status = getGitStatus(project.id);
  if (!status || !status.isGitRepo) return;

  const gitPath = getActiveGitPath(project.id);

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';

  // Position below the git status element
  const elRect = gitStatusEl.getBoundingClientRect();
  menu.style.left = `${elRect.left}px`;
  menu.style.top = `${elRect.bottom + 4}px`;

  // Show loading
  const loadingItem = document.createElement('div');
  loadingItem.className = 'tab-context-menu-item disabled';
  loadingItem.textContent = 'Loading branches…';
  menu.appendChild(loadingItem);

  document.body.appendChild(menu);
  setActiveContextMenu(menu);

  try {
    const branches = await window.vibeyard.git.listBranches(gitPath);

    // Menu was dismissed during loading
    if (getActiveContextMenu() !== menu) return;

    menu.innerHTML = '';
    menu.addEventListener('click', (ev) => ev.stopPropagation());

    const searchInput = document.createElement('input');
    searchInput.className = 'branch-search-input';
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter branches…';
    menu.appendChild(searchInput);

    const container = document.createElement('div');
    container.className = 'branch-list-container';
    menu.appendChild(container);

    let filteredBranches = branches;
    let activeIndex = 0;
    let itemElements: HTMLElement[] = [];

    function renderBranchItems(query: string): void {
      const lowerQuery = query.toLowerCase();
      filteredBranches = lowerQuery
        ? branches.filter(b => b.name.toLowerCase().includes(lowerQuery))
        : branches;
      activeIndex = 0;
      itemElements = [];
      container.innerHTML = '';

      if (filteredBranches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tab-context-menu-item disabled';
        empty.textContent = 'No matching branches';
        container.appendChild(empty);
        return;
      }

      for (let i = 0; i < filteredBranches.length; i++) {
        const branch = filteredBranches[i];
        const item = document.createElement('div');
        item.className = 'tab-context-menu-item'
          + (branch.current ? ' active' : '')
          + (i === activeIndex ? ' keyboard-active' : '');
        item.textContent = (branch.current ? '✓ ' : '  ') + branch.name;

        item.addEventListener('mouseenter', () => {
          activeIndex = i;
          setActiveHighlight();
        });

        if (!branch.current) {
          item.addEventListener('click', () => {
            hideTabContextMenu();
            switchBranch(gitPath, branch.name);
          });
        }
        itemElements.push(item);
        container.appendChild(item);
      }
    }

    function setActiveHighlight(): void {
      itemElements.forEach((el, i) => {
        el.classList.toggle('keyboard-active', i === activeIndex);
      });
    }

    function setActiveAndScroll(): void {
      setActiveHighlight();
      itemElements[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    searchInput.addEventListener('input', () => renderBranchItems(searchInput.value));

    searchInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          if (filteredBranches.length > 0) {
            activeIndex = (activeIndex + 1) % filteredBranches.length;
            setActiveAndScroll();
          }
          break;
        case 'ArrowUp':
          ev.preventDefault();
          if (filteredBranches.length > 0) {
            activeIndex = (activeIndex - 1 + filteredBranches.length) % filteredBranches.length;
            setActiveAndScroll();
          }
          break;
        case 'Enter':
          ev.preventDefault();
          if (activeIndex < filteredBranches.length) {
            const selected = filteredBranches[activeIndex];
            if (!selected.current) {
              hideTabContextMenu();
              switchBranch(gitPath, selected.name);
            }
          }
          break;
        case 'Escape':
          ev.preventDefault();
          hideTabContextMenu();
          break;
      }
    });

    renderBranchItems('');

    // Separator + Create New Branch
    const separator = document.createElement('div');
    separator.className = 'tab-context-menu-separator';
    menu.appendChild(separator);

    const createItem = document.createElement('div');
    createItem.className = 'tab-context-menu-item';
    createItem.textContent = 'Create New Branch…';
    createItem.addEventListener('click', () => {
      hideTabContextMenu();
      promptCreateBranch(gitPath);
    });
    menu.appendChild(createItem);

    positionMenu(menu);

    searchInput.focus();
  } catch {
    if (getActiveContextMenu() !== menu) return;
    menu.innerHTML = '';
    const errItem = document.createElement('div');
    errItem.className = 'tab-context-menu-item disabled';
    errItem.textContent = 'Failed to load branches';
    menu.appendChild(errItem);
  }
}

async function switchBranch(gitPath: string, branchName: string): Promise<void> {
  const project = appState.activeProject;
  const freshStatus = project ? getGitStatus(project.id) : null;
  const dirty = freshStatus ? freshStatus.staged + freshStatus.modified + freshStatus.conflicted : 0;
  if (dirty > 0) {
    const confirmed = confirm(`You have uncommitted changes. Switch to "${branchName}" anyway?`);
    if (!confirmed) return;
  }

  try {
    await window.vibeyard.git.checkoutBranch(gitPath, branchName);
    refreshGitStatus();
  } catch (err) {
    alert(`Failed to switch branch: ${err instanceof Error ? err.message : err}`);
  }
}

function promptCreateBranch(gitPath: string): void {
  showModal('Create New Branch', [
    { label: 'Branch name', id: 'branch-name', placeholder: 'feature/my-branch' },
  ], async (values) => {
    const name = values['branch-name']?.trim();
    if (!name) {
      setModalError('branch-name', 'Branch name is required');
      return;
    }
    if (/\s/.test(name)) {
      setModalError('branch-name', 'Branch name cannot contain spaces');
      return;
    }
    try {
      await window.vibeyard.git.createBranch(gitPath, name);
      closeModal();
      refreshGitStatus();
    } catch (err) {
      setModalError('branch-name', err instanceof Error ? err.message : 'Failed to create branch');
    }
  });
}
