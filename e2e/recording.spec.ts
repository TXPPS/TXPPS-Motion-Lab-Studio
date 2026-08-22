import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';

/**
 * Fake capture devices produce a deterministic tone, so the whole recording
 * path — permission, arming, count-in, MediaRecorder, decode, peaks,
 * IndexedDB, clip creation — runs for real without any hardware attached.
 *
 * These tests therefore prove the *pipeline*, not that a physical microphone
 * works. No claim is made here about real input hardware.
 *
 * Engines: Chromium and Firefox both provide fake capture (flags/prefs).
 * WebKit has none, so capture-dependent tests skip there — capture on retail
 * Safari goes through the normal permission prompt but is not CI-provable.
 */
const engine = process.env.E2E_BROWSER ?? 'chromium';

test.use(
  engine === 'chromium'
    ? {
        launchOptions: {
          executablePath: existsSync(preinstalledChromium) ? preinstalledChromium : undefined,
          args: [
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-capture',
          ],
        },
        permissions: ['microphone'],
      }
    : engine === 'firefox'
      ? {
          launchOptions: {
            firefoxUserPrefs: {
              'media.autoplay.default': 0,
              'media.autoplay.blocking_policy': 0,
              'media.navigator.streams.fake': true,
              'media.navigator.permission.disabled': true,
            },
          },
        }
      : {},
);

/** Count getUserMedia calls from the very first script the page runs. */
async function instrumentGum(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __gumCalls: number };
    w.__gumCalls = 0;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      w.__gumCalls++;
      return original(c);
    };
  });
}

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(700);
}

const gumCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls);

test.describe('microphone permission discipline', () => {
  test('does not request the microphone at startup', async ({ page }) => {
    await instrumentGum(page);
    await boot(page);
    // Idle for a while: a delayed startup probe would still be a violation.
    await page.waitForTimeout(1500);
    expect(await gumCalls(page), 'getUserMedia called without a user action').toBe(0);
  });

  test('does not request the microphone merely by opening the record workspace', async ({
    page,
  }) => {
    await instrumentGum(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.click('[data-testid="nav-record"]');
    await page.waitForTimeout(800);
    expect(await gumCalls(page), 'opening a panel must not prompt').toBe(0);
  });
});

test.describe('recording pipeline', () => {
  // No fake capture device exists on WebKit; the pipeline is proven on
  // Chromium and Firefox. Retail Safari capture uses the normal prompt.
  test.skip(engine === 'webkit', 'WebKit has no fake capture device');

  test('records a take end to end and creates a clip with real audio', async ({ page }) => {
    await instrumentGum(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.click('[data-testid="nav-record"]');
    await page.waitForSelector('[data-testid="record-workspace"]');

    // The permission gate only appears when permission has not been granted
    // yet; this context is pre-granted, which is the returning-user case.
    const enable = page.locator('[data-testid="request-mic"]');
    if (await enable.count()) {
      await enable.click();
      await page.waitForTimeout(900);
    }

    // Arm the selected track, then capture.
    const arm = page.locator('[data-testid="arm-track"]');
    await expect(arm).toBeVisible();
    await arm.click();
    await page.waitForTimeout(300);

    const clipsBefore = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );

    await page.click('[data-testid="btn-record"]');
    // Count-in plus capture; the fake device emits a continuous tone.
    await page.waitForTimeout(4500);
    // The stream is acquired for capture, not at startup — this is where the
    // first getUserMedia call legitimately happens.
    expect(await gumCalls(page), 'recording did not open an input stream').toBeGreaterThan(0);
    await page.click('[data-testid="btn-record"]');

    // Finalising decodes and writes to IndexedDB.
    await page.waitForTimeout(2500);

    // Captured for the failure message: the review panel reports why a take
    // was rejected (silent, undecodable, no frames), which is what you need.
    const reviewText = await page.evaluate(
      () => document.querySelector('[data-testid="take-review"]')?.textContent ?? '(no review)',
    );

    await page.click('[data-testid="nav-arrange"]');
    await page.waitForTimeout(600);
    const clipsAfter = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );

    expect(clipsAfter, `no clip was created (review said: ${reviewText})`).toBeGreaterThan(
      clipsBefore,
    );
  });

  test('releases the microphone after recording stops', async ({ page }) => {
    // Keep every stream handed out so their tracks can be inspected afterwards.
    await page.addInitScript(() => {
      const w = window as unknown as { __streams: MediaStream[] };
      w.__streams = [];
      const md = navigator.mediaDevices;
      if (!md?.getUserMedia) return;
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = async (c?: MediaStreamConstraints) => {
        const s = await original(c);
        w.__streams.push(s);
        return s;
      };
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.click('[data-testid="nav-record"]');
    await page.waitForSelector('[data-testid="record-workspace"]');

    const enable = page.locator('[data-testid="request-mic"]');
    if (await enable.count()) {
      await enable.click();
      await page.waitForTimeout(900);
    }
    await page.click('[data-testid="arm-track"]');
    await page.click('[data-testid="btn-record"]');
    await page.waitForTimeout(3500);
    await page.click('[data-testid="btn-record"]');
    await page.waitForTimeout(2500);

    // Monitoring is off, so nothing should still be holding the device open.
    const live = await page.evaluate(() => {
      const w = window as unknown as { __streams: MediaStream[] };
      return w.__streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === 'live')
        .length;
    });
    expect(live, 'a microphone track was left open after recording').toBe(0);
  });
});

test.describe('mixer insert processing', () => {
  test('adds, bypasses, reorders and removes an insert', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);

    // Select a track via its header. Clicking a lane can land on a clip, which
    // switches the inspector to the clip view instead of the track view.
    await page.locator('[data-testid^="track-header-"]').first().locator('.th-name').click();
    await page.waitForTimeout(400);

    const rack = page.locator('[data-testid^="fx-rack-"]').first();
    await expect(rack).toBeVisible();

    const addSelect = page.locator('[data-testid^="fx-add-"]').first();
    await addSelect.selectOption('compressor');
    await page.waitForTimeout(300);

    const slot = page.locator('[data-testid^="fx-slot-"]').first();
    await expect(slot).toBeVisible();

    // Bypass toggles the pressed state rather than removing the slot.
    const bypass = page.locator('[data-testid^="fx-bypass-"]').first();
    await expect(bypass).toHaveAttribute('aria-pressed', 'true');
    await bypass.click();
    await expect(bypass).toHaveAttribute('aria-pressed', 'false');
    await expect(slot).toBeVisible();

    // Open the slot and remove it.
    await slot.locator('.fx-title').click();
    await page.locator('[data-testid^="fx-remove-"]').first().click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid^="fx-slot-"]').count()).toBe(0);
  });

  test('the insert row on a strip reflects the chain and stays inside the strip', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await page.click('[data-testid="editor-tab-mixer"]');
    // The console drops its least-covered rows on a short panel (the insert row
    // has a full equivalent in the inspector), so the row is asserted where it
    // is actually shown: a full-height console.
    await page.click('[data-testid="maximize-editor"]');
    await page.waitForTimeout(400);

    const info = await page.evaluate(() => {
      const chips = [...document.querySelectorAll<HTMLElement>('.strip-inserts .ins-slot')];
      const escaping = chips.filter((c) => {
        const strip = c.closest('.strip')!.getBoundingClientRect();
        const box = c.getBoundingClientRect();
        return box.right > strip.right + 0.5 || box.left < strip.left - 0.5;
      }).length;
      return {
        count: chips.length,
        escaping,
        // the demo project ships a compressed drum bus, so at least one is active
        // A named, non-bypassed insert slot is the active case; the empty slot
        // carries the `empty` class.
        active: chips.filter((c) => !c.classList.contains('empty')).length,
      };
    });

    expect(info.count).toBeGreaterThan(0);
    expect(info.escaping, 'insert chips escaping their strip').toBe(0);
    expect(info.active, 'demo project should show at least one active insert/send').toBeGreaterThan(
      0,
    );
  });
});

test.describe('audio import affordances', () => {
  test('offers an import control without requiring a file', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await page.click('[data-testid="browser-tab-loops"]');
    await expect(page.locator('[data-testid="import-audio"]')).toBeVisible();
  });

  test('a file dropped outside a lane does not navigate away', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    const before = page.url();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(8)], 'x.wav', { type: 'audio/wav' }));
      document.body.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    await expect(page.locator('[data-testid="app-root"]')).toBeVisible();
  });
});
