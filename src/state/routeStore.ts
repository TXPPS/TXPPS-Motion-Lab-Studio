import { create } from 'zustand';
import { currentRoute, parseHash, type PageId, type Route } from '../app/router';

interface RouteState {
  route: Route;
  /** Set from the hashchange listener installed once by the app shell. */
  setRoute: (r: Route) => void;
  go: (page: PageId) => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  route: currentRoute(),
  setRoute: (route) => set({ route }),
  go: (page) => {
    const next = { ...currentRoute(), page };
    set({ route: next });
    const hash = `#/${page}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  },
}));

/** Install once, from the app shell. Returns the teardown. */
export function watchRoute(): () => void {
  const apply = () => useRouteStore.getState().setRoute(parseHash(window.location.hash));
  apply();
  window.addEventListener('hashchange', apply);
  return () => window.removeEventListener('hashchange', apply);
}
