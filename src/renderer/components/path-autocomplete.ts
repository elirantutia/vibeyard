import { basename, lastSeparatorIndex } from '../../shared/platform.js';

const EMPTY_LISTING_TTL_MS = 5_000;

export interface PathAutocompleteOptions {
  /** SSH host whose filesystem to list; '' = the local filesystem. Read on every keystroke. */
  getHost: () => string;
  /** Called after the input value changes (typing, picking a suggestion, blur). */
  onValueChange?: (value: string) => void;
}

/**
 * Directory autocomplete for a modal path input (local or over SSH). Returns
 * `refresh`, which re-lists suggestions for the current value — call it after
 * changing the input programmatically (e.g. when the host select changes).
 */
export function attachPathAutocomplete(pathInput: HTMLInputElement, opts: PathAutocompleteOptions): { refresh: () => void } {
  const fieldRow = pathInput.parentElement!;
  fieldRow.style.position = 'relative';
  fieldRow.style.flexWrap = 'wrap';

  const dropdown = document.createElement('div');
  dropdown.className = 'path-autocomplete-dropdown';
  fieldRow.appendChild(dropdown);

  let activeIndex = -1;
  const notify = () => opts.onValueChange?.(pathInput.value);

  const hideDropdown = () => {
    dropdown.innerHTML = '';
    dropdown.classList.remove('visible');
    activeIndex = -1;
  };

  // A remote pick appends '/' and re-lists, so the user can keep drilling down.
  const pick = (text: string) => {
    const host = opts.getHost();
    pathInput.value = text + (host ? '/' : '');
    hideDropdown();
    notify();
    if (host) refresh();
  };

  const showSuggestions = (dirs: string[], dirPart: string) => {
    dropdown.innerHTML = '';
    activeIndex = -1;
    if (dirs.length === 0) { hideDropdown(); return; }
    for (const dir of dirs) {
      const item = document.createElement('div');
      item.className = 'path-autocomplete-item';
      item.textContent = dirPart + basename(dir);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(item.textContent!);
      });
      dropdown.appendChild(item);
    }
    dropdown.classList.add('visible');
  };

  // Remote listings cost an SSH round-trip: cache per host+dir and drop
  // responses that arrive after the input has moved on.
  const remoteCache = new Map<string, Promise<string[]>>();
  let requestSeq = 0;

  const updateSuggestions = async () => {
    const value = pathInput.value;
    const host = opts.getHost();
    notify();
    // Bumped before any early return too, so a listing still in flight for an
    // earlier value can never reopen the dropdown.
    const seq = ++requestSeq;
    const lastSlash = host ? value.lastIndexOf('/') : lastSeparatorIndex(value);
    if (lastSlash === -1) { hideDropdown(); return; }

    const dirPart = value.substring(0, lastSlash + 1);
    const namePart = value.substring(lastSlash + 1).toLowerCase();

    let dirs: string[];
    if (host) {
      const key = `${host}|${dirPart}`;
      let pending = remoteCache.get(key);
      if (!pending) {
        pending = window.vibeyard.remote.listDirs(host, dirPart).catch(() => []);
        remoteCache.set(key, pending);
        // listDirs reports failure as [] (same as a folder with no subfolders), so
        // keep an empty result only briefly: long enough not to spawn ssh per
        // keystroke, short enough not to pin a transient SSH failure.
        void pending.then((names) => {
          if (names.length === 0) setTimeout(() => { if (remoteCache.get(key) === pending) remoteCache.delete(key); }, EMPTY_LISTING_TTL_MS);
        });
      }
      const names = await pending;
      dirs = names.filter((n) => !namePart || n.toLowerCase().startsWith(namePart)).slice(0, 50);
    } else {
      dirs = await window.vibeyard.fs.listDirs(dirPart, namePart || undefined);
    }
    if (seq !== requestSeq) return;
    showSuggestions(dirs, dirPart);
  };
  const refresh = () => { void updateSuggestions(); };

  pathInput.addEventListener('input', refresh);

  pathInput.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll<HTMLElement>('.path-autocomplete-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[activeIndex]?.classList.remove('active');
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[activeIndex]?.classList.remove('active');
      activeIndex = Math.max(activeIndex - 1, 0);
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if ((e.key === 'Enter' || e.key === 'Tab') && activeIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pick(items[activeIndex].textContent!);
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  pathInput.addEventListener('blur', () => {
    setTimeout(hideDropdown, 100);
    notify();
  });

  return { refresh };
}
