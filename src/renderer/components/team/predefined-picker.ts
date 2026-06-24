import type { TeamMember } from '../../../shared/types.js';
import { TEAM_DOMAINS, TEAM_DOMAIN_LABELS } from '../../../shared/team-config.js';
import { appState } from '../../state.js';
import { renderMarkdownContent } from '../file-reader.js';
import { fetchPredefinedMembers, isCacheFresh } from './github-fetcher.js';
import { filterMembers, type DomainFilter } from './predefined-filter.js';
import { bindModalDismiss } from '../modal-manager.js';
import { t } from '../../i18n.js';

interface DialogState {
  overlay: HTMLDivElement;
  list: HTMLDivElement;
  status: HTMLDivElement;
  searchInput: HTMLInputElement;
  footerCount: HTMLDivElement;
  chips: Map<DomainFilter, HTMLButtonElement>;
  allSuggestions: TeamMember[];
  query: string;
  activeDomain: DomainFilter;
}

export async function showPredefinedPicker(): Promise<void> {
  const state = buildDialog();
  document.body.appendChild(state.overlay);

  const cache = appState.team.predefinedCache;
  if (cache && isCacheFresh(cache)) {
    state.allSuggestions = cache.suggestions;
    rerender(state);
  } else {
    await load(state);
  }
}

function buildDialog(): DialogState {
  const overlay = document.createElement('div');
  overlay.className = 'team-picker-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'team-picker-dialog';

  const header = document.createElement('div');
  header.className = 'team-picker-header';
  const title = document.createElement('div');
  title.className = 'team-picker-title';
  title.textContent = t('team.picker.title');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'team-picker-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t('team.picker.closeAriaLabel'));

  header.appendChild(title);
  header.appendChild(closeBtn);

  const status = document.createElement('div');
  status.className = 'team-picker-status';

  const filterRow = document.createElement('div');
  filterRow.className = 'team-picker-filter';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'team-picker-search-wrap';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'team-picker-search-icon';
  searchIcon.innerHTML =
    '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="4.25"/><line x1="9.25" y1="9.25" x2="12.5" y2="12.5"/></svg>';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'team-picker-search';
  searchInput.placeholder = t('team.picker.searchPlaceholder');
  searchWrap.appendChild(searchIcon);
  searchWrap.appendChild(searchInput);

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'team-picker-domain-chips';

  const chips = new Map<DomainFilter, HTMLButtonElement>();
  const filters: DomainFilter[] = ['all', ...TEAM_DOMAINS];
  for (const filter of filters) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'team-picker-chip';
    chip.textContent = filter === 'all' ? t('team.picker.allChip') : TEAM_DOMAIN_LABELS[filter];
    if (filter === 'all') chip.classList.add('active');
    chips.set(filter, chip);
    chipsWrap.appendChild(chip);
  }

  filterRow.appendChild(searchWrap);
  filterRow.appendChild(chipsWrap);

  const list = document.createElement('div');
  list.className = 'team-picker-list';

  const footer = document.createElement('div');
  footer.className = 'team-picker-footer';
  const footerCount = document.createElement('div');
  footerCount.className = 'team-picker-footer-count';
  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn-primary';
  doneBtn.textContent = t('team.picker.doneButton');
  footer.appendChild(footerCount);
  footer.appendChild(doneBtn);

  dialog.appendChild(header);
  dialog.appendChild(status);
  dialog.appendChild(filterRow);
  dialog.appendChild(list);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  const state: DialogState = {
    overlay,
    list,
    status,
    searchInput,
    footerCount,
    chips,
    allSuggestions: [],
    query: '',
    activeDomain: 'all',
  };
  updateFooterCount(state);

  for (const [filter, chip] of chips) {
    chip.addEventListener('click', () => selectDomain(state, filter));
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = searchInput.value.trim().toLowerCase();
      rerender(state);
    }, 150);
  });

  const dispose = (): void => {
    teardownDismiss();
    overlay.remove();
  };
  const teardownDismiss = bindModalDismiss({ overlay, onClose: dispose });
  closeBtn.addEventListener('click', dispose);
  doneBtn.addEventListener('click', dispose);

  return state;
}

function selectDomain(state: DialogState, filter: DomainFilter): void {
  if (state.activeDomain === filter) return;
  state.activeDomain = filter;
  for (const [key, el] of state.chips) el.classList.toggle('active', key === filter);
  rerender(state);
}

async function load(state: DialogState): Promise<void> {
  state.status.textContent = t('team.picker.loading');
  state.list.innerHTML = '';
  try {
    const suggestions = await fetchPredefinedMembers();
    appState.setTeamPredefinedCache(suggestions);
    state.allSuggestions = suggestions;
    rerender(state);
  } catch (err) {
    state.status.textContent = t('team.picker.loadError', { err: err instanceof Error ? err.message : String(err) });
  }
}

function updateFooterCount(state: DialogState): void {
  const count = appState.getTeamMembers().length;
  const projectName = appState.activeProject?.name;
  const noun = count === 1 ? t('team.picker.memberNounSingular') : t('team.picker.memberNounPlural');
  state.footerCount.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = String(count);
  state.footerCount.appendChild(strong);
  state.footerCount.appendChild(
    document.createTextNode(projectName
      ? t('team.picker.footerCountWithProject', { noun, projectName })
      : t('team.picker.footerCountGeneric', { noun })),
  );
}

function rerender(state: DialogState): void {
  state.list.innerHTML = '';
  if (state.allSuggestions.length === 0) {
    state.status.textContent = t('team.picker.empty');
    return;
  }
  state.status.textContent = '';

  const filtered = filterMembers(state.allSuggestions, state.query, state.activeDomain);

  if (filtered.length === 0) {
    state.list.appendChild(buildEmptyState(state));
    return;
  }

  const installed = new Set(appState.getTeamMembers().map((m) => m.id));

  const buckets = new Map<TeamDomain, TeamMember[]>();
  for (const suggestion of filtered) {
    const key = suggestion.domain ?? 'other';
    const bucket = buckets.get(key) ?? [];
    bucket.push(suggestion);
    buckets.set(key, bucket);
  }

  for (const domain of TEAM_DOMAINS) {
    const members = buckets.get(domain);
    if (!members || members.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'team-picker-section';

    const heading = document.createElement('div');
    heading.className = 'team-picker-section-title';
    heading.textContent = TEAM_DOMAIN_LABELS[domain];
    section.appendChild(heading);

    const cards = document.createElement('div');
    cards.className = 'team-picker-section-cards';
    for (const member of members) {
      cards.appendChild(buildCard(state, member, installed.has(member.id)));
    }
    section.appendChild(cards);

    state.list.appendChild(section);
  }
}

function buildEmptyState(state: DialogState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'team-picker-empty';

  const msg = document.createElement('div');
  msg.textContent = t('team.picker.noMatches');
  wrap.appendChild(msg);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'team-picker-empty-clear';
  clear.textContent = t('team.picker.clearFilters');
  clear.addEventListener('click', () => {
    state.query = '';
    state.activeDomain = 'all';
    state.searchInput.value = '';
    for (const [key, el] of state.chips) el.classList.toggle('active', key === 'all');
    rerender(state);
  });
  wrap.appendChild(clear);

  return wrap;
}

function buildCard(state: DialogState, member: TeamMember, isInstalled: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'team-picker-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const header = document.createElement('div');
  header.className = 'team-card-header';

  const avatar = document.createElement('div');
  avatar.className = 'team-card-avatar';
  avatar.textContent = initials(member.name);

  header.appendChild(avatar);
  header.appendChild(buildNameRole(member));
  card.appendChild(header);

  if (member.description) {
    const desc = document.createElement('div');
    desc.className = 'team-card-description';
    desc.textContent = member.description;
    card.appendChild(desc);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-primary team-picker-card-add';
  applyAddState(addBtn, isInstalled, t('team.picker.addToTeam'), t('team.picker.added'));
  const onAdd = (): void => {
    addMember(member);
    applyAddState(addBtn, true, t('team.picker.addToTeam'), t('team.picker.added'));
    updateFooterCount(state);
  };
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onAdd();
  });
  card.appendChild(addBtn);

  const open = (): void => {
    showMemberDetail(member, onAdd, addBtn.disabled);
  };
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  return card;
}

function showMemberDetail(member: TeamMember, onAdd: () => void, isInstalled: boolean): void {
  const overlay = document.createElement('div');
  overlay.className = 'team-picker-detail-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'team-picker-detail-dialog';

  const header = document.createElement('div');
  header.className = 'team-picker-detail-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'team-picker-detail-back';
  backBtn.textContent = '‹';
  backBtn.setAttribute('aria-label', t('team.picker.backAriaLabel'));

  const titleWrap = buildNameRole(member);
  titleWrap.classList.add('team-picker-detail-title');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'team-picker-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t('team.picker.closeAriaLabel'));

  header.appendChild(backBtn);
  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'team-picker-detail-body';

  body.appendChild(renderMarkdownContent(member.systemPrompt ?? ''));

  const footer = document.createElement('div');
  footer.className = 'team-picker-detail-footer';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-primary btn-sm team-picker-card-add';
  applyAddState(addBtn, isInstalled, t('team.picker.addToTeam'), t('team.picker.alreadyAdded'));
  addBtn.addEventListener('click', () => {
    onAdd();
    applyAddState(addBtn, true, t('team.picker.addToTeam'), t('team.picker.alreadyAdded'));
  });
  footer.appendChild(addBtn);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const dispose = (): void => {
    teardownDismiss();
    overlay.remove();
  };
  const teardownDismiss = bindModalDismiss({ overlay, onClose: dispose });
  backBtn.addEventListener('click', dispose);
  closeBtn.addEventListener('click', dispose);
}

function buildNameRole(member: TeamMember): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'team-card-heading';

  const nameEl = document.createElement('div');
  nameEl.className = 'team-card-name';
  nameEl.textContent = member.name;

  const roleEl = document.createElement('div');
  roleEl.className = 'team-card-role';
  roleEl.textContent = member.role;

  wrap.appendChild(nameEl);
  wrap.appendChild(roleEl);
  return wrap;
}

function addMember(member: TeamMember): void {
  appState.addTeamMember({
    id: member.id,
    name: member.name,
    role: member.role,
    description: member.description,
    systemPrompt: member.systemPrompt,
    source: 'predefined',
    sourceUrl: member.sourceUrl,
    installAsAgent: true,
  });
}

function applyAddState(btn: HTMLButtonElement, isInstalled: boolean, addLabel: string, addedLabel: string): void {
  btn.disabled = isInstalled;
  btn.textContent = isInstalled
    ? t('team.picker.addedGlyph', { label: addedLabel })
    : t('team.picker.addGlyph', { label: addLabel });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
}
