import { writable } from 'svelte/store';

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  isSuperadmin?: boolean;
};

export const currentUser = writable<CurrentUser | null>(null);
