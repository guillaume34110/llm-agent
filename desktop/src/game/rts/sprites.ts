// Iron Marsh sprite set. Chunky pixel art drawn on a 16-unit grid with fillRect so
// it stays crisp at any integer zoom (canvas uses imageRendering:pixelated). Each
// role gets a shaded silhouette — a light edge, a body, and a shadow side — so the
// shapes read as volumes, not flat blocks. Faction-tinted (Human = steel/cyan,
// Lizard = green/bone) with a small owner pip so player vs enemy reads at a glance.
//
// Pure rendering: no sim coupling, no numbers that touch state. Caller translates so
// the box's top-left is at the current origin, then calls drawSprite(..., size).

import type { EntityKind, Faction, Owner } from './types';

interface Pal {
  body: string; light: string; dark: string; shadow: string;
  accent: string; glass: string; metal: string; metalLight: string;
}
const HUMAN: Pal = {
  body: '#8fb9c9', light: '#cdeaf2', dark: '#1e2a31', shadow: '#41606d',
  accent: '#d6f1f7', glass: '#7fd8ec', metal: '#6c8a98', metalLight: '#a6c2cd',
};
const LIZARD: Pal = {
  body: '#7cae4a', light: '#b6dd78', dark: '#172110', shadow: '#3b5322',
  accent: '#cfe89a', glass: '#f0d63a', metal: '#5e7c34', metalLight: '#8caf52',
};
const OWNER = { player: '#6fd3e0', enemy: '#e06f78' } as const;
const ORE = { dark: '#8a6a22', mid: '#caa23a', light: '#f0d676' };

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  role: EntityKind,
  faction: Faction,
  owner: Owner,
  size: number,
  t = 0,
) {
  const u = size / 16;
  const P = faction === 'human' ? HUMAN : LIZARD;
  const R = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x * u), Math.round(y * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u)));
  };
  const px = (x: number, y: number, c: string) => R(x, y, 1, 1, c);
  const blink = (t % 1100) < 550;
  const bob = faction === 'human' ? Math.round(Math.sin(t / 240)) : Math.round(Math.sin(t / 300));
  const oc = OWNER[owner];

  switch (role) {
    // ── Units ────────────────────────────────────────────────────────────────
    case 'infantry': {
      const step = Math.floor(t / 140) % 2 === 0 ? 1 : -1;
      const y = 1 + bob;
      if (faction === 'human') {
        R(5 - step, y + 12, 2, 3, P.dark); R(9 + step, y + 12, 2, 3, P.dark);   // legs
        R(5 - step, y + 14, 2, 1, P.shadow); R(9 + step, y + 14, 2, 1, P.shadow); // boots
        R(5, y + 6, 6, 7, P.body); R(5, y + 6, 1, 7, P.light);                 // torso + lit edge
        R(10, y + 6, 1, 7, P.shadow);                                          // shaded edge
        R(5, y + 9, 6, 1, P.dark);                                             // belt
        R(6, y + 2, 4, 4, P.light); R(9, y + 3, 1, 3, P.shadow);               // head
        R(5, y + 1, 6, 2, P.metal); R(5, y + 1, 6, 1, P.metalLight);           // helmet
        R(10, y + 5, 5, 1, P.dark); R(10, y + 4, 4, 1, P.metal);               // rifle
      } else {
        R(1, y + 11, 4, 2, P.shadow); px(0, y + 12, P.dark);                   // tail
        R(5 - step, y + 12, 2, 3, P.dark); R(9 + step, y + 12, 2, 3, P.dark);  // legs
        R(5, y + 7, 6, 6, P.body); R(5, y + 7, 1, 6, P.light);                 // body + lit edge
        R(6, y + 10, 4, 2, P.accent);                                          // belly
        R(9, y + 4, 5, 3, P.body); R(13, y + 5, 2, 2, P.light);               // head + snout
        for (let i = 0; i < 3; i++) px(9 + i, y + 3, P.shadow);                // crest
        px(11, y + 5, blink ? P.glass : P.dark);                               // eye
        R(9, y + 7, 5, 1, P.metal);                                            // weapon
      }
      break;
    }
    case 'at': {
      const step = Math.floor(t / 140) % 2 === 0 ? 1 : -1;
      const y = 1 + bob;
      R(5 - step, y + 12, 2, 3, P.dark); R(9 + step, y + 12, 2, 3, P.dark);    // legs
      R(5, y + 6, 6, 7, P.body); R(5, y + 6, 1, 7, P.light); R(10, y + 6, 1, 7, P.shadow); // torso
      if (faction === 'lizard') { R(1, y + 11, 4, 2, P.shadow); R(13, y + 6, 2, 2, P.light); } // tail+snout
      R(6, y + 2, 4, 4, P.light); R(5, y + 1, 6, 2, P.metal);                  // head
      R(8, y + 3, 7, 2, P.metalLight); R(8, y + 4, 7, 1, P.metal);             // rocket tube
      R(14, y + 3, 1, 2, '#e8b23a'); px(15, y + 3, '#ffd76a');                 // warhead tip
      R(8, y + 5, 2, 1, P.dark);                                               // grip
      break;
    }
    case 'tank': {
      const y = 1 + bob;
      R(2, y + 11, 12, 4, P.dark);                                            // tread block
      R(2, y + 11, 12, 1, P.shadow);                                          // tread top lip
      for (let i = 0; i < 5; i++) px(3 + i * 2, y + 13, P.metal);             // tread links
      R(3, y + 7, 10, 4, P.body); R(3, y + 7, 10, 1, P.light);               // hull + top light
      R(3, y + 10, 10, 1, P.shadow);                                          // hull shadow
      R(6, y + 4, 5, 3, P.metalLight); R(6, y + 6, 5, 1, P.shadow);          // turret
      R(10, y + 5, 6, 1, P.metal); R(10, y + 5, 6, 1, P.metalLight);         // barrel
      if (faction === 'lizard') { px(4, y + 6, P.accent); px(11, y + 6, P.accent); R(5, y + 8, 6, 1, P.accent); } // bio trim
      break;
    }
    case 'siege': {
      const y = 1 + bob;
      R(2, y + 12, 12, 3, P.dark); R(2, y + 12, 12, 1, P.shadow);             // treads
      for (let i = 0; i < 5; i++) px(3 + i * 2, y + 13, P.metal);
      R(4, y + 9, 8, 3, P.body); R(4, y + 9, 8, 1, P.light);                  // chassis
      R(7, y + 8, 3, 2, P.metalLight);                                        // mount
      R(8, y + 6, 2, 2, P.metal); R(9, y + 4, 2, 2, P.metal); R(10, y + 2, 3, 2, P.metalLight); // cannon
      R(12, y + 1, 2, 2, P.dark);                                             // muzzle
      if (faction === 'lizard') R(13, y + 1, 2, 2, P.accent);
      break;
    }
    case 'harvester': {
      const y = 1 + bob;
      R(2, y + 11, 12, 4, P.dark); R(2, y + 11, 12, 1, P.shadow);             // wheels
      for (let i = 0; i < 4; i++) R(3 + i * 3, y + 12, 2, 2, P.metal);        // wheel hubs
      R(3, y + 6, 8, 5, P.body); R(3, y + 6, 8, 1, P.light); R(3, y + 10, 8, 1, P.shadow); // body
      R(3, y + 3, 4, 4, P.metalLight); R(4, y + 4, 3, 2, P.glass);            // cab + window
      R(10, y + 4, 5, 6, P.metal); R(10, y + 4, 5, 1, P.metalLight);          // ore bucket
      R(11, y + 4, 3, 2, ORE.mid); R(11, y + 5, 2, 1, ORE.light); px(13, y + 6, ORE.dark); // ore load
      break;
    }
    case 'apex': {
      const y = bob;
      if (faction === 'human') {
        R(3, y + 10, 3, 5, P.dark); R(10, y + 10, 3, 5, P.dark);              // legs
        R(3, y + 14, 3, 1, P.shadow); R(10, y + 14, 3, 1, P.shadow);          // feet
        R(4, y + 4, 8, 7, P.body); R(4, y + 4, 8, 1, P.light); R(11, y + 4, 1, 7, P.shadow); // chassis
        R(6, y + 5, 4, 3, P.glass); px(6, y + 5, P.accent);                   // cockpit
        R(0, y + 5, 4, 2, P.metal); R(12, y + 5, 4, 2, P.metal);              // shoulder cannons
        R(0, y + 5, 4, 1, P.metalLight); R(12, y + 5, 4, 1, P.metalLight);
        R(7, y + 1, 2, 3, P.metal); R(7, y + 1, 2, 1, blink ? '#7fffea' : P.dark); // sensor mast
      } else {
        R(0, y + 9, 4, 2, P.shadow); px(0, y + 8, P.dark);                    // tail
        R(3, y + 12, 2, 3, P.dark); R(7, y + 12, 2, 3, P.dark); R(11, y + 12, 2, 3, P.dark); // legs
        R(3, y + 5, 9, 7, P.body); R(3, y + 5, 9, 1, P.light); R(4, y + 8, 7, 2, P.accent); // body+belly
        for (let i = 0; i < 5; i++) R(4 + i * 2, y + 2, 1, 3, P.shadow);      // back spikes
        R(11, y + 4, 4, 4, P.body); R(14, y + 6, 2, 2, P.light);             // head + jaw
        R(13, y + 5, 1, 1, blink ? P.glass : P.dark);                         // eye
        R(11, y + 8, 4, 1, P.dark);                                           // mouth
      }
      break;
    }

    // ── Buildings ──────────────────────────────────────────────────────────────
    case 'hq': {
      R(1, 10, 14, 5, P.shadow);                                             // footprint shadow
      R(2, 9, 12, 6, P.metal); R(2, 9, 12, 1, P.metalLight);                 // base
      R(3, 5, 10, 5, P.body); R(3, 5, 10, 1, P.light); R(12, 5, 1, 5, P.shadow); // main block
      R(5, 2, 5, 3, P.metalLight); R(5, 2, 5, 1, P.light);                   // tower
      R(7, 11, 2, 4, P.dark);                                                // door
      R(4, 6, 2, 2, P.glass); R(10, 6, 2, 2, P.glass);                       // windows
      R(7, 0, 1, 2, P.dark); px(7, 0, blink ? '#ffe45e' : P.metal);          // beacon
      if (faction === 'lizard') { R(2, 4, 1, 3, P.accent); R(13, 4, 1, 3, P.accent); }
      break;
    }
    case 'power': {
      R(1, 11, 14, 4, P.shadow);
      R(2, 10, 12, 5, P.metal); R(2, 10, 12, 1, P.metalLight);              // base
      R(3, 4, 4, 7, P.body); R(9, 4, 4, 7, P.body);                          // two towers
      R(3, 4, 1, 7, P.light); R(9, 4, 1, 7, P.light);                        // lit edges
      R(6, 4, 1, 7, P.shadow); R(12, 4, 1, 7, P.shadow);                     // shaded edges
      R(3, 3, 4, 1, P.accent); R(9, 3, 4, 1, P.accent);                      // caps
      const glow = blink ? '#ffe45e' : '#c8b23a';
      R(7, 6, 2, 5, glow); px(7, 7, '#fff6b0');                              // energy arc
      break;
    }
    case 'refinery': {
      R(1, 11, 14, 4, P.shadow);
      R(2, 10, 12, 5, P.metal); R(2, 10, 12, 1, P.metalLight);              // base
      R(3, 3, 4, 8, P.body); R(3, 3, 1, 8, P.light); R(6, 3, 1, 8, P.shadow); // silo
      R(3, 3, 4, 1, P.accent);                                               // silo cap
      R(8, 6, 6, 5, P.metalLight); R(8, 6, 6, 1, P.light);                  // dock
      R(9, 8, 5, 3, ORE.mid); R(9, 8, 4, 1, ORE.light); R(11, 10, 2, 1, ORE.dark); // ore pile
      R(8, 11, 6, 1, P.dark);                                                // dock lip
      break;
    }
    case 'barracks': {
      R(1, 9, 14, 6, P.shadow);
      R(2, 8, 12, 7, P.body); R(2, 8, 1, 7, P.light); R(13, 8, 1, 7, P.shadow); // block
      R(1, 6, 14, 2, P.metal); R(1, 6, 14, 1, P.metalLight);               // roof
      R(7, 10, 2, 5, P.dark); px(7, 10, P.shadow);                          // door
      R(4, 11, 2, 2, P.glass); R(10, 11, 2, 2, P.glass);                    // windows
      R(3, 1, 1, 6, P.metal); R(4, 1, 4, 2, oc); px(4, 1, '#ffffff');       // owner flag
      if (faction === 'lizard') { R(2, 5, 1, 1, P.accent); R(13, 5, 1, 1, P.accent); }
      break;
    }
    case 'factory': {
      R(1, 8, 14, 7, P.shadow);
      R(2, 7, 12, 8, P.body); R(2, 7, 1, 8, P.light); R(13, 7, 1, 8, P.shadow); // hangar
      R(1, 5, 14, 2, P.metal); R(1, 5, 14, 1, P.metalLight);               // arched roof
      R(5, 9, 6, 6, P.dark);                                                // big door
      for (let i = 0; i < 3; i++) R(5, 10 + i * 2, 6, 1, P.metal);          // door slats
      R(3, 4, 2, 1, P.metalLight); R(7, 4, 2, 1, P.metalLight); R(11, 4, 2, 1, P.metalLight); // vents
      if (faction === 'lizard') R(2, 7, 12, 1, P.accent);
      break;
    }
    case 'tech': {
      R(2, 10, 12, 5, P.shadow);
      R(3, 9, 10, 6, P.metal); R(3, 9, 10, 1, P.metalLight);              // base
      R(4, 6, 8, 3, P.body); R(4, 6, 8, 1, P.light); R(11, 6, 1, 3, P.shadow); // lab
      R(5, 4, 6, 2, P.glass); R(5, 4, 6, 1, P.accent);                     // dome
      R(8, 1, 1, 3, P.metal); R(7, 1, 4, 1, P.metalLight);                // dish arm
      px(5, 11, blink ? '#7fffa0' : P.dark); px(10, 11, blink ? '#7fffa0' : P.dark); // status lights
      break;
    }
    case 'defense': {
      R(3, 11, 10, 4, P.shadow);
      R(4, 10, 8, 5, P.metal); R(4, 10, 8, 1, P.metalLight);              // base
      R(6, 13, 4, 2, P.dark);                                              // base notch
      if (faction === 'human') {
        R(5, 6, 6, 4, P.body); R(5, 6, 6, 1, P.light); R(10, 6, 1, 4, P.shadow); // turret head
        R(10, 6, 5, 1, P.metalLight); R(10, 8, 5, 1, P.metal);            // twin barrels
        px(7, 7, P.glass);                                                 // optic
      } else {
        R(6, 2, 4, 9, P.body); R(6, 2, 1, 9, P.light); R(9, 2, 1, 9, P.shadow); // bio-spire
        R(6, 1, 4, 2, P.accent);                                           // bulb
        R(7, 3, 2, 1, blink ? '#aaff66' : P.dark);                         // glow
        R(5, 6, 1, 2, P.shadow); R(10, 7, 1, 2, P.shadow);                // tendrils
      }
      break;
    }
  }

  // Owner pip (top-right) — guarantees side is readable even on twin factions.
  R(13, 0, 3, 3, oc); px(13, 0, '#ffffff');
}
