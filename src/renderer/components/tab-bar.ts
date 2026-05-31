// Re-export shim: tab-bar was split into the ./tab-bar/ folder. This preserves
// the original import path for existing consumers.
export { initTabBar } from './tab-bar/index.js';
export { quickNewSession, promptNewSession } from './tab-bar/session-menu.js';
