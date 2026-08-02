/**
 * Public surface of src/chars: the six character factories keyed by
 * CharacterName. `flat` builds the 2D heraldic emblem instead of the figure.
 */

import type { CharacterName, Faction } from '../core/contract.ts';
import type {
  CharacterFactory,
  CharacterOptions,
  CharacterRig,
} from '../core/stage.ts';
import { buildBerserkr } from './berserkr.ts';
import { buildEmblem, HEIGHTS } from './emblems.ts';
import { buildHuscarl } from './huscarl.ts';
import { buildJarl } from './jarl.ts';
import { buildJotunn } from './jotunn.ts';
import { buildValkyrie } from './valkyrie.ts';
import { buildVolva } from './volva.ts';

const FULL: Record<CharacterName, (faction: Faction) => CharacterRig> = {
  huscarl: buildHuscarl,
  berserkr: buildBerserkr,
  volva: buildVolva,
  jotunn: buildJotunn,
  valkyrie: buildValkyrie,
  jarl: buildJarl,
};

function factory(name: CharacterName): CharacterFactory {
  return (faction, opts) =>
    opts?.flat ? buildEmblem(name, faction) : FULL[name](faction);
}

export const CHARACTER_FACTORIES: Record<CharacterName, CharacterFactory> = {
  huscarl: factory('huscarl'),
  berserkr: factory('berserkr'),
  volva: factory('volva'),
  jotunn: factory('jotunn'),
  valkyrie: factory('valkyrie'),
  jarl: factory('jarl'),
};

export function buildCharacter(
  name: CharacterName,
  faction: Faction,
  opts?: CharacterOptions,
): CharacterRig {
  return CHARACTER_FACTORIES[name](faction, opts);
}

export const CHARACTER_HEIGHTS: Record<CharacterName, number> = HEIGHTS;

export { factionMaterials } from './materials.ts';
export type { FactionMaterials } from './materials.ts';
