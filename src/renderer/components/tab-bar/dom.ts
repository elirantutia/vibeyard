// Tab-bar DOM refs shared across more than one module. Button refs that only
// initTabBar touches stay local to index.ts.
export const tabListEl = document.getElementById('tab-list')!;
export const gitStatusEl = document.getElementById('git-status')!;
