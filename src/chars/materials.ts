/**
 * One shared MeshStandardMaterial set per faction. Factions must stay
 * readable in greyscale: ash is high-value (pale birch, bone, bright steel),
 * ember is low-value (charred oak, dark iron) with faint coal emissive.
 */

import { MeshStandardMaterial } from 'three';
import type { Faction } from '../core/contract.ts';

export interface FactionMaterials {
  wood: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  /**
   * Mail and darkened harness: a half-step down in value from `steel` and
   * much rougher, so riveted rows read as texture beside polished plate
   * instead of merging with it.
   */
  mail: MeshStandardMaterial;
  cloth: MeshStandardMaterial;
  hide: MeshStandardMaterial;
  bone: MeshStandardMaterial;
  stone: MeshStandardMaterial;
  accent: MeshStandardMaterial;
  /** Warm metal for regalia — crowns, ring finials, pommels. */
  gold: MeshStandardMaterial;
  void: MeshStandardMaterial;
  /**
   * Emblem backing, value-inverted per faction (dark under pale ash
   * heraldry, pale under dark ember heraldry) so 2D pieces stay readable.
   */
  plate: MeshStandardMaterial;
}

const cache = new Map<Faction, FactionMaterials>();

function makeSet(faction: Faction): FactionMaterials {
  if (faction === 'ash') {
    return {
      wood: new MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.85 }),
      steel: new MeshStandardMaterial({
        color: 0xdfe6ec,
        roughness: 0.35,
        metalness: 0.75,
      }),
      mail: new MeshStandardMaterial({
        color: 0xb4bec6,
        roughness: 0.62,
        metalness: 0.65,
      }),
      cloth: new MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.95 }),
      hide: new MeshStandardMaterial({ color: 0xc4b294, roughness: 0.9 }),
      bone: new MeshStandardMaterial({ color: 0xefe8d4, roughness: 0.7 }),
      stone: new MeshStandardMaterial({ color: 0xcfc9bb, roughness: 0.95 }),
      accent: new MeshStandardMaterial({ color: 0xf4eedb, roughness: 0.5 }),
      gold: new MeshStandardMaterial({
        color: 0xe6d6a6,
        roughness: 0.38,
        metalness: 0.7,
      }),
      void: new MeshStandardMaterial({ color: 0x2b2721, roughness: 1 }),
      plate: new MeshStandardMaterial({ color: 0x2b2721, roughness: 0.9 }),
    };
  }
  return {
    wood: new MeshStandardMaterial({ color: 0x2c211a, roughness: 0.9 }),
    steel: new MeshStandardMaterial({
      color: 0x33363b,
      roughness: 0.5,
      metalness: 0.7,
    }),
    mail: new MeshStandardMaterial({
      color: 0x25282c,
      roughness: 0.7,
      metalness: 0.6,
    }),
    cloth: new MeshStandardMaterial({ color: 0x241d19, roughness: 0.95 }),
    hide: new MeshStandardMaterial({ color: 0x2f2620, roughness: 0.9 }),
    bone: new MeshStandardMaterial({ color: 0x453a30, roughness: 0.75 }),
    stone: new MeshStandardMaterial({ color: 0x36312b, roughness: 0.95 }),
    accent: new MeshStandardMaterial({
      color: 0x3a2014,
      roughness: 0.6,
      emissive: 0xff5a22,
      emissiveIntensity: 0.55,
    }),
    gold: new MeshStandardMaterial({
      color: 0x5c4018,
      roughness: 0.42,
      metalness: 0.68,
    }),
    void: new MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }),
    plate: new MeshStandardMaterial({ color: 0xcbc3b4, roughness: 0.9 }),
  };
}

export function factionMaterials(faction: Faction): FactionMaterials {
  let set = cache.get(faction);
  if (!set) {
    set = makeSet(faction);
    cache.set(faction, set);
  }
  return set;
}
