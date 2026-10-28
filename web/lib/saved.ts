"use client";
// Saved businesses and searches. Kept in this browser; when signed in they're also saved to the
// account, which is the master copy (so they follow the visitor to other devices).
export type SavedBiz = { id: string; name: string; city: string };
export type SavedSearch = { label: string; query: string };
export type Account = { email: string; name: string | null; picture: string | null };

const BIZ = "bizestimate:saved", SEARCHES = "bizestimate:searches", ACCOUNT = "bizestimate:account";

const read = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};
const write = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); window.dispatchEvent(new Event("saved-changed")); } catch { /* storage off */ }
};

export const account = () => read<Account | null>(ACCOUNT, null);

function remote(body: object) {
  if (!account()) return;
  fetch("/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

export const savedBusinesses = () => read<SavedBiz[]>(BIZ, []);
export const isSaved = (id: string) => savedBusinesses().some((b) => b.id === id);
export function toggleSaved(b: SavedBiz) {
  const list = savedBusinesses();
  const was = list.some((x) => x.id === b.id);
  write(BIZ, was ? list.filter((x) => x.id !== b.id) : [b, ...list].slice(0, 200));
  remote({ op: was ? "unsave" : "save", business: b });
}
export const savedSearches = () => read<SavedSearch[]>(SEARCHES, []);
export function saveSearch(s: SavedSearch) {
  write(SEARCHES, [s, ...savedSearches().filter((x) => x.query !== s.query)].slice(0, 50));
  remote({ op: "save_search", search: s });
}
export function removeSearch(query: string) {
  write(SEARCHES, savedSearches().filter((x) => x.query !== query));
  remote({ op: "remove_search", query });
}

// On page load: who's signed in, and their saved lists. The first time an account is seen in this
// browser, what was saved here before signing in is added to it.
export async function syncAccount(): Promise<{ user: Account | null; signInAvailable: boolean }> {
  const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  if (!me) return { user: account(), signInAvailable: false };
  if (!me.user) {
    if (account()) { write(ACCOUNT, null); write(BIZ, []); write(SEARCHES, []); }   // signed out elsewhere
    return { user: null, signInAvailable: !!me.signInAvailable };
  }
  let lists = me;
  if (account()?.email !== me.user.email) {
    lists = await fetch("/api/me", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "merge", businesses: savedBusinesses(), searches: savedSearches() }),
    }).then((r) => r.json()).catch(() => me);
  }
  write(ACCOUNT, me.user);
  write(BIZ, lists.businesses ?? []);
  write(SEARCHES, lists.searches ?? []);
  return { user: me.user, signInAvailable: true };
}

export async function deleteAccount() {
  if (!window.confirm("Delete your account and everything saved to it? This can't be undone.")) return;
  await fetch("/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "delete_account" }) }).catch(() => {});
  write(ACCOUNT, null); write(BIZ, []); write(SEARCHES, []);
  window.location.reload();
}

export async function signOut() {
  await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
  // Clear this browser's copy: the lists stay in the account.
  write(ACCOUNT, null); write(BIZ, []); write(SEARCHES, []);
  window.location.reload();
}
