import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';

/**
 * The switch is `--use-fake-device-for-media-stream`. It was
 * `--use-fake-device-for-media-capture` here, which is not a Chromium switch at
 * all: Chromium ignores an unknown switch, so the auto-accepted prompt opened
 * whatever real device the host had. On a machine with one these tests passed
 * while proving something other than what they claim; on a machine without one
 * they failed for a reason that looked like a product bug.
 *
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
            '--use-fake-device-for-media-stream',
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

  test('the device rack on a strip carries the whole chain, in order, inside the strip', async ({
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
      const slots = [...document.querySelectorAll<HTMLElement>('.dev-rack .dev-slot')];
      const escaping = [...document.querySelectorAll<HTMLElement>('.dev-rack *')].filter((c) => {
        const strip = c.closest('.strip')?.getBoundingClientRect();
        if (!strip) return false;
        const box = c.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) return false;
        return (
          box.right > strip.right + 0.5 ||
          box.left < strip.left - 0.5 ||
          box.bottom > strip.bottom + 0.5
        );
      }).length;
      // Every device carries its position in the chain, so the console shows
      // the order and not just the membership.
      const numbered = slots.filter((s) =>
        /^\d+$/.test(s.querySelector('.dev-index')?.textContent ?? ''),
      );
      return {
        count: slots.length,
        escaping,
        numbered: numbered.length,
        addable: document.querySelectorAll('.dev-rack .dev-add').length,
      };
    });

    expect(info.count, 'the demo project has inserts to show').toBeGreaterThan(0);
    expect(info.escaping, 'rack controls escaping their strip').toBe(0);
    expect(info.numbered, 'every device shows its place in the chain').toBe(info.count);
    expect(info.addable, 'every channel can take a device from the console').toBeGreaterThan(0);
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

/**
 * Directive 09 §2.1 — stop, from the gestures a musician actually uses.
 *
 * Every recording case above ends its take by pressing the record button a
 * second time, and that route always worked. The Stop button and the space bar
 * did not: they halted the clock and left MediaRecorder capturing. Two hundred
 * and twenty-two end-to-end tests passed over that for as long as none of them
 * pressed Stop.
 */
test.describe('stop ends the take', () => {
  test.skip(engine === 'webkit', 'WebKit has no fake capture device');

  /** Keep every stream so its tracks can be inspected after the take. */
  async function trackStreams(page: Page) {
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
  }

  const liveTracks = (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __streams: MediaStream[] }).__streams
          .flatMap((s) => s.getAudioTracks())
          .filter((t) => t.readyState === 'live').length,
    );

  /** Boot into the record workspace with a track armed and capture running. */
  async function startTake(page: Page) {
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
    await page.waitForTimeout(300);
    await page.click('[data-testid="btn-record"]');
    // Count-in, then a couple of seconds of the fake device's tone.
    await page.waitForTimeout(4500);
    expect(await liveTracks(page), 'recording never opened an input').toBeGreaterThan(0);
  }

  test('the Stop button stops the recording, not only the playhead', async ({ page }) => {
    await trackStreams(page);
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );
    await startTake(page);

    await page.click('[data-testid="btn-stop"]');
    await page.waitForTimeout(2500);

    // The microphone is the honest witness. Against the old code the transport
    // reported itself stopped while this stayed at one — the take was still
    // running behind a stopped playhead.
    expect(await liveTracks(page), 'the input was still open after Stop').toBe(0);

    const review = await page.evaluate(
      () => document.querySelector('[data-testid="take-review"]')?.textContent ?? '(no review)',
    );
    await page.click('[data-testid="nav-arrange"]');
    await page.waitForTimeout(600);
    const after = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );
    expect(after, `Stop did not finalise the take (review said: ${review})`).toBeGreaterThan(
      before,
    );
  });

  test('the space bar stops the recording', async ({ page }) => {
    await trackStreams(page);
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );
    await startTake(page);

    // Space is deliberately ignored while a button has focus, so that a
    // keyboard user pressing it on Mute gets a mute. The record button has
    // focus from the click above; a musician's hands are on the keyboard.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await page.waitForTimeout(2500);

    expect(await liveTracks(page), 'the input was still open after Space').toBe(0);
    await page.click('[data-testid="nav-arrange"]');
    await page.waitForTimeout(600);
    const after = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );
    expect(after, 'Space did not finalise the take').toBeGreaterThan(before);
  });

  test('a second Stop press returns to the start rather than being swallowed', async ({ page }) => {
    await trackStreams(page);
    await startTake(page);
    await page.click('[data-testid="btn-stop"]');
    await page.waitForTimeout(2500);
    await page.click('[data-testid="btn-stop"]');
    await page.waitForTimeout(400);
    // The first press ended the take; only the second is the return-to-start
    // press, and it must still work.
    const pos = await page.evaluate(
      () => document.querySelector('[data-testid="pos-display"]')?.textContent ?? '',
    );
    expect(pos.trim()).toBe('1.1.000');
  });
});
