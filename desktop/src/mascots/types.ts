import type { ComponentType, SVGProps } from 'react';

export type MascotSVG = ComponentType<SVGProps<SVGSVGElement>>;

export type FamilyId =
  | 'botanical'
  | 'feline'
  | 'canine'
  | 'primate'
  | 'equid'
  | 'megafauna'
  | 'rodent'
  | 'ursine'
  | 'avian'
  | 'reptile'
  | 'mythic'
  | 'marine'
  | 'shell'
  | 'insect';

export type MascotRole =
  | 'fixed-ground'   // anchored to floor, static decor (mushroom, flower, shell, tree)
  | 'walker'         // slides horizontally along floor (snail, crab, cat, dog)
  | 'hopper'         // parabolic jumps along floor (frog, rabbit)
  | 'flyer'          // sine/figure-8 in air band (butterfly, bee, bird)
  | 'swimmer'        // gentle wave motion in lower band (fish, whale, octopus)
  | 'cloud'          // slow horizontal drift across sky band (cloud, moon)
  | 'sparkle'        // twinkle in place (star, sparkle, dewdrop)
  | 'climber';       // hangs from top edge (vine, web)

export interface MascotEntry {
  id: string;
  Component: MascotSVG;
  weight?: number;
  role?: MascotRole; // default 'fixed-ground'
}
