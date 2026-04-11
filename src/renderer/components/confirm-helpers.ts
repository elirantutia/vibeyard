export interface ActiveStatusCounts {
  working: number;
  waiting: number;
  input: number;
}

const STATUS_COLORS: Record<string, string> = {
  working: '#e94560',
  waiting: '#f4b400',
  input: '#e67e22',
};

const STATUS_LABELS: Record<string, string> = {
  working: 'working',
  waiting: 'waiting',
  input: 'needs input',
};

export function countActiveStatuses(statuses: string[]): ActiveStatusCounts {
  const counts: ActiveStatusCounts = { working: 0, waiting: 0, input: 0 };
  for (const s of statuses) {
    if (s === 'working') counts.working++;
    else if (s === 'waiting') counts.waiting++;
    else if (s === 'input') counts.input++;
  }
  return counts;
}

export function buildWarningBannerDetail(counts: ActiveStatusCounts): string {
  const parts: string[] = [];
  for (const key of ['working', 'waiting', 'input'] as const) {
    if (counts[key] > 0) {
      const color = STATUS_COLORS[key];
      const label = STATUS_LABELS[key];
      parts.push(`<span><span style="color:${color}">&#9679;</span> ${counts[key]} ${label}</span>`);
    }
  }

  return `<div class="confirm-warning-header">\u26A0 Warning: Active sessions will be terminated</div>`
    + `<div class="confirm-status-line">${parts.join('')}</div>`;
}
