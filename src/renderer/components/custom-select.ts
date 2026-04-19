export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface CustomSelectInstance {
  element: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  destroy(): void;
}

export function createCustomSelect(
  id: string,
  options: SelectOption[],
  defaultValue?: string,
  onChange?: (value: string) => void,
): CustomSelectInstance {
  const defaultOpt = options.find(o => o.value === defaultValue) ?? options.find(o => !o.disabled) ?? options[0];

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.id = id;
  hidden.value = defaultOpt?.value ?? '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.textContent = defaultOpt?.label ?? '';

  const dropdown = document.createElement('div');
  dropdown.className = 'custom-select-dropdown';

  let activeIndex = -1;
  const items: HTMLElement[] = [];

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const item = document.createElement('div');
    item.className = 'custom-select-item';
    item.textContent = opt.label;
    item.dataset.value = opt.value;
    if (opt.disabled) item.classList.add('disabled');
    if (opt.value === hidden.value) item.classList.add('selected');

    item.addEventListener('mouseenter', () => {
      if (!opt.disabled) {
        activeIndex = i;
        updateActive();
      }
    });

    item.addEventListener('click', () => {
      if (!opt.disabled) selectOption(i);
    });

    items.push(item);
    dropdown.appendChild(item);
  }

  function selectOption(index: number): void {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    const changed = hidden.value !== opt.value;
    hidden.value = opt.value;
    trigger.textContent = opt.label;
    items.forEach(el => el.classList.remove('selected'));
    items[index].classList.add('selected');
    closeDropdown();
    if (changed) onChange?.(opt.value);
  }

  function updateActive(): void {
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    if (activeIndex >= 0) items[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function openDropdown(): void {
    dropdown.classList.add('visible');
    trigger.classList.add('open');
    activeIndex = options.findIndex(o => o.value === hidden.value);
    updateActive();
  }

  function closeDropdown(): void {
    dropdown.classList.remove('visible');
    trigger.classList.remove('open');
    activeIndex = -1;
    items.forEach(el => el.classList.remove('active'));
  }

  function isOpen(): boolean {
    return dropdown.classList.contains('visible');
  }

  trigger.addEventListener('click', () => {
    if (isOpen()) closeDropdown();
    else openDropdown();
  });

  trigger.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!isOpen()) openDropdown();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let next = activeIndex;
      for (let attempt = 0; attempt < options.length; attempt++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next].disabled) {
          activeIndex = next;
          break;
        }
      }
      updateActive();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen() && activeIndex >= 0) selectOption(activeIndex);
      else if (!isOpen()) openDropdown();
    } else if (e.key === 'Escape') {
      if (isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      }
    } else if (e.key === 'Tab') {
      closeDropdown();
    }
  });

  const onOutsideClick = (e: MouseEvent) => {
    if (!isOpen()) return;
    if (!wrapper.contains(e.target as Node)) closeDropdown();
  };
  document.addEventListener('mousedown', onOutsideClick);

  wrapper.appendChild(hidden);
  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);

  return {
    element: wrapper,
    getValue() { return hidden.value; },
    setValue(value: string) {
      const index = options.findIndex(o => o.value === value);
      if (index < 0 || options[index].disabled) return;
      hidden.value = options[index].value;
      trigger.textContent = options[index].label;
      items.forEach((el, i) => el.classList.toggle('selected', i === index));
    },
    destroy() { document.removeEventListener('mousedown', onOutsideClick); },
  };
}
