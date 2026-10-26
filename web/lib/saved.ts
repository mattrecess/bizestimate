"use client";
// Saved businesses and searches, kept in this browser only (until accounts exist).
export type SavedBiz = { id: string; name: string; city: string };
export type SavedSearch = { label: string; query: string };

const read = <T,>(key: string): T[] => {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
};
const write = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); window.dispatchEvent(new Event("saved-changed")); } catch { /* storage off */ }
};

export const savedBusinesses = () => read<SavedBiz>("bizestimate:saved");
export const isSaved = (id: string) => savedBusinesses().some((b) => b.id === id);
export function toggleSaved(b: SavedBiz) {
  const list = savedBusinesses();
  write("bizestimate:saved", list.some((x) => x.id === b.id) ? list.filter((x) => x.id !== b.id) : [b, ...list].slice(0, 200));
}
export const savedSearches = () => read<SavedSearch>("bizestimate:searches");
export function saveSearch(s: SavedSearch) {
  write("bizestimate:searches", [s, ...savedSearches().filter((x) => x.query !== s.query)].slice(0, 50));
}
export function removeSearch(query: string) {
  write("bizestimate:searches", savedSearches().filter((x) => x.query !== query));
}
