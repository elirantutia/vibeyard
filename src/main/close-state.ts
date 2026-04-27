let closeConfirmed = false;

export function isCloseConfirmed(): boolean {
  return closeConfirmed;
}

export function setCloseConfirmed(value: boolean): void {
  closeConfirmed = value;
}
