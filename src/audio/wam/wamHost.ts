/**
 * One-time WAM host setup, per audio context.
 *
 * Two things have to exist before any plugin can be instantiated:
 *
 * 1. A `WamEnv` singleton installed on the `AudioWorkletGlobalScope`, which is
 *    how plugin processors find each other. `initializeWamHost` puts it there
 *    by stringifying two setup functions into Blob URLs and calling
 *    `audioWorklet.addModule` on each. It takes a `BaseAudioContext`, so it
 *    works on an `OfflineAudioContext` too — which is the whole reason a bounce
 *    can go through the same renderer as the monitor path.
 * 2. The plugin's ES module, imported from its URL. Vite must not try to
 *    resolve that URL at build time, hence a `@vite-ignore` comment.
 *
 * Both are cached: the host per context (a `WeakMap`, so an offline context
 * from a finished render is collectable), and the module per URL, process-wide.
 * The module cache matters more than it looks — an export of a project with
 * sixteen plugin instances would otherwise re-import and re-`addModule`
 * sixteen times before the render could start.
 *
 * This module is also where the first `AudioWorklet` in this codebase gets
 * used. Everything in `effectChain.ts` is a native Web Audio node; a plugin is
 * not, and that has one consequence worth stating: a plugin whose `process()`
 * throws or hangs takes the audio thread down for the whole tab, and no host
 * can prevent that. See docs/KNOWN-LIMITATIONS.md.
 */
import { diagLog } from '../../state/diagnostics';
import { isWamConstructor, type WebAudioModuleConstructor } from './types';

/** Group id and key handed back by `initializeWamHost`, per context. */
const hosts = new WeakMap<BaseAudioContext, Promise<string>>();
/** Resolved plugin constructors by URL. Import is cached by the browser too,
 *  but this also caches the "is it actually a WAM" check and the failure. */
const modules = new Map<string, Promise<WebAudioModuleConstructor>>();

let isolationChecked = false;

/**
 * Warn if the page ever becomes cross-origin isolated.
 *
 * We deliberately do not set COOP/COEP: the WAM SDK's `SharedArrayBuffer`
 * transport is opt-in by the plugin *and* feature-gated on the constructor
 * existing, and browsers hide that constructor unless the page is isolated — so
 * without isolation every plugin quietly falls back to the `MessagePort` path
 * and everything works. Enabling isolation would cost us cross-origin assets,
 * complicate the service worker's precache, and make loading plugins from other
 * origins *harder*, in exchange for a faster path we do not use (our automation
 * is scheduled ahead of time, and offline rendering never touches it at all).
 *
 * The point of the check is that a future dependency could turn isolation on
 * without us intending it, and that would change plugin behaviour underneath
 * us. So we assert the assumption rather than assume it.
 */
export function checkCrossOriginIsolation(): boolean {
  const isolated =
    typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated;
  if (!isolationChecked) {
    isolationChecked = true;
    if (isolated) {
      diagLog(
        'warn',
        'Page is cross-origin isolated. Plugins will use the SharedArrayBuffer event ' +
          'transport, which we have not tested. Nothing here asked for COOP/COEP — ' +
          'check what turned it on.',
      );
    } else {
      diagLog('info', 'Plugin host: not cross-origin isolated (expected) — MessagePort transport.');
    }
  }
  return isolated;
}

/**
 * Install the WAM environment on a context and return its group id.
 *
 * Concurrent callers share one promise, so a project with eight plugins calls
 * `addModule` twice, not sixteen times.
 */
export function wamHostFor(ctx: BaseAudioContext): Promise<string> {
  const existing = hosts.get(ctx);
  if (existing) return existing;
  const p = (async () => {
    checkCrossOriginIsolation();
    if (!ctx.audioWorklet) {
      throw new Error('This browser has no AudioWorklet, so it cannot run plugins.');
    }
    const { initializeWamHost } = await import('@webaudiomodules/sdk');
    const [groupId] = (await initializeWamHost(ctx)) as [string, string];
    return groupId;
  })();
  // A failed host init must not be cached as a permanent failure: the next
  // attempt (a retry, a fresh render context) deserves a clean try.
  p.catch(() => hosts.delete(ctx));
  hosts.set(ctx, p);
  return p;
}

/**
 * Import a plugin's entry module and check that it really is one.
 *
 * A host that does not send `Access-Control-Allow-Origin` cannot be loaded by
 * us at all, and the failure a bare `import()` produces for that says nothing
 * useful — so we name it, because "example.com does not allow other sites to
 * load its plugins" is actionable and "Failed to fetch dynamically imported
 * module" is not.
 */
export function loadPluginModule(url: string): Promise<WebAudioModuleConstructor> {
  const existing = modules.get(url);
  if (existing) return existing;
  const p = (async () => {
    let mod: { default?: unknown };
    try {
      mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`could not fetch the plugin from ${url} (${msg})`);
    }
    const ctor = mod.default;
    if (!isWamConstructor(ctor)) {
      throw new Error(`${url} loaded, but it is not a Web Audio Modules plugin.`);
    }
    return ctor;
  })();
  p.catch(() => modules.delete(url));
  modules.set(url, p);
  return p;
}
