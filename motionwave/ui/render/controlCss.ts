/**
 * Motion Wave — how the control primitives are painted.
 *
 * Colour comes from the panel's own skin variables rather than from the palette
 * tokens, because a knob on a light 1950s fascia and the same knob on a black
 * 1970s one are not the same object with a different background. The tokens
 * still own everything that is not the fascia: focus, meters, lamps, motion.
 *
 * The 44 px floor is applied to the element that receives the press, never to a
 * wrapper around it. MotionLab's RA-002 was a strip grown to 44 px inside a row
 * that was not, so 25 of those pixels were clipped on every touch device; the
 * shape of that mistake is sizing the box beside the target instead of the
 * target.
 */
const SHELL = `
.mw-ctl {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mw-space-1);
  min-width: max(var(--mw-target-min), var(--mw-ctl-min, 4.5rem));
  min-height: var(--mw-target-min);
  padding: var(--mw-space-2);
  border-radius: var(--mw-radius-md);
  color: var(--mw-panel-ink-muted);
  font-size: var(--mw-text-xs);
  text-align: center;
  cursor: grab;
  /* A label may not widen its column: without this a control named "Right or
     vertical channel timing network charge" sets its own min-content width from
     its longest word and the grid track grows past its share, overflowing the
     document while every individual box stays inside the viewport. */
  overflow-wrap: anywhere;
}
.mw-ctl[data-mw-dragging] { cursor: grabbing; }
.mw-ctl-art { display: block; width: var(--mw-ctl-size, 3.5rem); line-height: 0; }
.mw-ctl-art > svg { display: block; width: 100%; height: auto; overflow: visible; }
/* The keyboard and the screen reader's route in, and nothing else's: the
   pointer belongs to the primitive. Opacity rather than display:none or
   visibility:hidden, both of which take an element out of the focus order
   entirely and would leave these controls operable only by finger. */
.mw-ctl-a11y {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  appearance: none;
}
.mw-ctl:focus-within {
  outline: var(--mw-hairline-strong) solid var(--mw-focus);
  outline-offset: var(--mw-space-1);
}
.mw-ctl-label {
  display: block;
  font-size: var(--mw-text-2xs);
  line-height: var(--mw-leading-tight);
  color: var(--mw-panel-ink);
}
.mw-ctl-value {
  display: block;
  font-family: var(--mw-font-numeric);
  font-size: var(--mw-text-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--mw-panel-ink-muted);
}
`;

const ROTARY = `
.mw-knob-track { fill: none; stroke: var(--mw-fascia-low); stroke-width: 5; stroke-linecap: round; }
.mw-knob-value { fill: none; stroke: var(--mw-panel-lamp); stroke-width: 5; stroke-linecap: round; }
.mw-knob-tick { stroke: var(--mw-panel-ink-muted); stroke-width: 1.4; }
.mw-knob-skirt { fill: var(--mw-fascia-low); stroke: var(--mw-fascia-high); stroke-width: 1; }
.mw-knob-cap {
  fill: var(--mw-fascia-high);
  stroke: var(--mw-fascia-low);
  stroke-width: 1.5;
}
.mw-knob-hub { fill: var(--mw-fascia-low); }
.mw-knob-pointer { stroke: var(--mw-panel-ink); stroke-width: 3.4; stroke-linecap: round; }
.mw-knob-flute { stroke: var(--mw-fascia-low); stroke-width: 1.6; }
.mw-knob-notch { fill: var(--mw-panel-ink); }
.mw-selector-name {
  fill: var(--mw-panel-ink-muted);
  font-family: var(--mw-font-ui);
  font-size: 9px;
  letter-spacing: 0.03em;
}
/* The rotor turns instantly under a finger and eases when a value arrives from
   elsewhere — a preset load, an automation lane. Both are the same property, so
   the transition is short enough not to lag the hand. */
.mw-knob-rotor { transition: transform var(--mw-motion-fast) var(--mw-ease-standard); }
.mw-ctl[data-mw-dragging] .mw-knob-rotor { transition: none; }
`;

const SWITCHES = `
.mw-switch-plate { fill: var(--mw-fascia-low); stroke: var(--mw-fascia-high); stroke-width: 1.2; }
.mw-switch-bush { fill: var(--mw-fascia-high); }
.mw-switch-bat { fill: var(--mw-fascia-high); stroke: var(--mw-fascia-low); stroke-width: 1; }
.mw-switch-tip { fill: var(--mw-fascia-high); stroke: var(--mw-fascia-low); stroke-width: 1; }
.mw-switch-lever { transition: transform var(--mw-motion-fast) var(--mw-ease-standard); }
.mw-rocker-half { fill: var(--mw-fascia); stroke: var(--mw-fascia-low); stroke-width: 1; }
.mw-rocker-lamp { fill: var(--mw-fascia-low); }
.mw-switch[data-mw-on='true'] .mw-rocker-top { fill: var(--mw-fascia-high); }
.mw-switch[data-mw-on='true'] .mw-rocker-lamp { fill: var(--mw-panel-lamp); }
.mw-switch[data-mw-on='false'] .mw-rocker-bottom { fill: var(--mw-fascia-high); }
.mw-button-cap { fill: var(--mw-fascia-high); stroke: var(--mw-fascia-low); stroke-width: 2; }
.mw-button-lamp { fill: var(--mw-fascia-low); }
.mw-switch[data-mw-on='true'] .mw-button-lamp { fill: var(--mw-panel-lamp); }
.mw-ctl[data-mw-pressed] .mw-button-cap { fill: var(--mw-fascia); }
`;

const FADER = `
.mw-fader-slot { fill: var(--mw-fascia-low); }
.mw-fader-travel { fill: var(--mw-panel-lamp); }
.mw-fader-tick { stroke: var(--mw-panel-ink-muted); stroke-width: 1; }
.mw-fader-tick-major { stroke-width: 1.8; }
.mw-fader-cap rect { fill: var(--mw-fascia-high); stroke: var(--mw-fascia-low); stroke-width: 1.5; }
.mw-fader-line { stroke: var(--mw-panel-ink); stroke-width: 2; }
.mw-fader-cap { transition: transform var(--mw-motion-fast) var(--mw-ease-standard); }
.mw-ctl[data-mw-dragging] .mw-fader-cap { transition: none; }
`;

const READOUTS = `
.mw-vu { width: 100%; max-width: 12rem; }
.mw-vu-face { display: block; width: 100%; height: auto; }
.mw-vu-plate { fill: var(--mw-meter-bg); stroke: var(--mw-fascia-low); stroke-width: 1; }
.mw-vu-arc { fill: none; stroke: var(--mw-fg-muted); stroke-width: 1.2; }
.mw-vu-red { fill: none; stroke: var(--mw-meter-over); stroke-width: 2.4; }
.mw-vu-tick { stroke: var(--mw-fg-muted); stroke-width: 1; }
.mw-vu-tick-major { stroke: var(--mw-fg); stroke-width: 1.8; }
.mw-vu-label { fill: var(--mw-fg-muted); font-family: var(--mw-font-numeric); font-size: 7px; }
.mw-vu-needle { stroke: var(--mw-fg); stroke-width: 1.8; stroke-linecap: round; }
.mw-vu-pivot { fill: var(--mw-fg-muted); }
.mw-vu-lamp { fill: var(--mw-meter-bg); stroke: var(--mw-fg-muted); stroke-width: 0.8; }
.mw-vu-lamp[data-mw-on='true'] { fill: var(--mw-meter-over); }

.mw-bar {
  position: relative;
  flex: 1 1 6rem;
  min-width: 4rem;
  height: var(--mw-space-4);
  border-radius: var(--mw-radius-pill);
  background: var(--mw-meter-bg);
  overflow: hidden;
}
.mw-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--mw-bar-extent, 0%);
  background: linear-gradient(90deg, var(--mw-meter-low), var(--mw-meter-mid) 62%, var(--mw-meter-high) 84%, var(--mw-meter-over));
}
.mw-bar-reduction .mw-bar-fill { background: var(--mw-meter-reduction); }
.mw-bar-peak {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--mw-bar-peak, 0%);
  width: var(--mw-hairline-strong);
  background: var(--mw-fg);
}

.mw-lamp { width: var(--mw-space-6); }
.mw-lamp-face { display: block; width: 100%; height: auto; }
.mw-lamp-bezel { fill: var(--mw-fascia-low); }
.mw-lamp-glass { fill: var(--mw-meter-bg); }
.mw-lamp[data-mw-on='true'] .mw-lamp-glass { fill: var(--mw-panel-lamp); }

.mw-display {
  padding: var(--mw-space-2) var(--mw-space-3);
  border-radius: var(--mw-radius-sm);
  background: var(--mw-meter-bg);
  color: var(--mw-fg);
  font-family: var(--mw-font-numeric);
  font-size: var(--mw-text-sm);
  font-variant-numeric: tabular-nums;
}
`;

const CURVE = `
.mw-curve {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  border-radius: var(--mw-radius-md);
  background: var(--mw-meter-bg);
  border: var(--mw-hairline) solid var(--mw-fascia-low);
  touch-action: none;
}
.mw-curve:focus-visible { outline: var(--mw-hairline-strong) solid var(--mw-focus); }
.mw-curve-face { display: block; width: 100%; height: 100%; }
.mw-curve-gridline { stroke: var(--mw-line); stroke-width: 1; }
.mw-curve-path { fill: none; stroke: var(--mw-modulation); stroke-width: 2.2; stroke-linejoin: round; }
.mw-curve-playhead { stroke: var(--mw-automation); stroke-width: 1.5; }
/* Invisible and large: the target a finger has to hit is not the dot a finger
   has to see. Drawing them the same size is RA-002 restated as a circle. */
.mw-curve-target { fill: transparent; }
.mw-curve-node { fill: var(--mw-bg-app); stroke: var(--mw-modulation); stroke-width: 2.4; }
.mw-curve-node-selected { fill: var(--mw-modulation); }
`;

const MOTION = `
@media (prefers-reduced-motion: reduce) {
  .mw-knob-rotor,
  .mw-switch-lever,
  .mw-fader-cap { transition-duration: var(--mw-motion-instant); }
}
@media (pointer: coarse) {
  /* A finger, not a mouse. The art grows rather than the padding, so the thing
     under the thumb is the control and not the space beside it. */
  .mw-panel { --mw-ctl-size: max(3.25rem, var(--mw-ctl-size, 3.5rem)); }
  .mw-ctl { min-height: max(var(--mw-target-min), 3rem); }
}
`;

export const CONTROL_CSS = `${SHELL}${ROTARY}${SWITCHES}${FADER}${READOUTS}${CURVE}${MOTION}`;
