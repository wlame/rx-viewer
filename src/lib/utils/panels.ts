/**
 * The panels of the side panel, in the order the activity bar shows
 * their buttons. A further panel is one row here and its view in
 * `Sidebar.svelte`.
 */
import type { IconName } from './icons';
import type { ShortcutId } from './shortcuts';
import type { SidebarTab } from './urlState';

export interface PanelSpec {
  id: SidebarTab;
  /** The name of the panel's button. */
  label: string;
  icon: IconName;
  /** The row of the key that shows the panel and moves the focus into it. */
  shortcut: ShortcutId;
}

export const PANELS: readonly PanelSpec[] = [
  { id: 'tree', label: 'Files', icon: 'files', shortcut: 'showFiles' },
  { id: 'search', label: 'Search', icon: 'search', shortcut: 'showSearch' },
];
