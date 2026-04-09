import type { BoardTask } from '../shared/types.js';

type FilterChangeCallback = () => void;

let searchQuery = '';
let activeTags: Set<string> = new Set();
const listeners: FilterChangeCallback[] = [];

export function setSearchQuery(query: string): void {
  const normalized = query.toLowerCase().trim();
  if (normalized === searchQuery) return;
  searchQuery = normalized;
  notify();
}

export function getSearchQuery(): string {
  return searchQuery;
}

export function toggleTagFilter(tagName: string): void {
  const normalized = tagName.toLowerCase().trim();
  if (activeTags.has(normalized)) {
    activeTags.delete(normalized);
  } else {
    activeTags.add(normalized);
  }
  notify();
}

export function isTagFilterActive(tagName: string): boolean {
  return activeTags.has(tagName.toLowerCase().trim());
}

export function getActiveTagFilters(): ReadonlySet<string> {
  return activeTags;
}

export function clearFilters(): void {
  searchQuery = '';
  activeTags.clear();
  notify();
}

export function hasActiveFilters(): boolean {
  return searchQuery !== '' || activeTags.size > 0;
}

export function matchesFilter(task: BoardTask): boolean {
  if (searchQuery) {
    const haystack = `${task.title}\n${task.prompt}`.toLowerCase();
    if (!haystack.includes(searchQuery)) return false;
  }

  if (activeTags.size > 0) {
    if (!task.tags || task.tags.length === 0) return false;
    const hasMatch = task.tags.some(t => activeTags.has(t));
    if (!hasMatch) return false;
  }

  return true;
}

export function getFilteredTasks(tasks: BoardTask[]): BoardTask[] {
  if (!hasActiveFilters()) return tasks;
  return tasks.filter(matchesFilter);
}

export function onFilterChange(callback: FilterChangeCallback): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}
