export function wireSubmitDisabled(
  textarea: HTMLTextAreaElement,
  ...btns: HTMLButtonElement[]
): void {
  const sync = (): void => {
    const empty = textarea.value.trim().length === 0;
    for (const b of btns) b.disabled = empty;
  };
  sync();
  textarea.addEventListener('input', sync);
}
