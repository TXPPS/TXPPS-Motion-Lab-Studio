/**
 * Every project-store recipe, assembled.
 *
 * Split by domain rather than kept in one list because a single file of 132
 * recipes is a file describing eight things, and the house rule against that
 * exists for the same reason the sweep does: a long list stops being read.
 */
import type { Handles } from '../fixture';
import type { Recipe } from '../harness';
import { arrangementRecipes } from './arrangement';
import { automationRecipes } from './automation';
import { clipRecipes } from './clips';
import { effectRecipes } from './effects';
import { mixRecipes } from './mix';
import { noteRecipes } from './notes';
import { samplerRecipes } from './sampler';
import { sessionRecipes } from './session';

export function projectRecipes(h: Handles): Recipe[] {
  return [
    ...clipRecipes(h),
    ...noteRecipes(h),
    ...effectRecipes(h),
    ...samplerRecipes(h),
    ...automationRecipes(h),
    ...arrangementRecipes(h),
    ...mixRecipes(h),
    ...sessionRecipes(h),
  ];
}
