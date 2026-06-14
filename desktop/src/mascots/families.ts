import type { AnimalId } from '../animals/registry';
import type { FamilyId } from './types';

const FAMILY_BY_ANIMAL: Partial<Record<AnimalId, FamilyId>> = {
  monkey: 'primate', ape: 'primate', gorilla: 'primate', orangutan: 'primate',

  dog: 'canine', poodle: 'canine', guide_dog: 'canine', service_dog: 'canine',
  wolf: 'canine', fox: 'canine', raccoon: 'canine',

  cat: 'feline', black_cat: 'feline', lion: 'feline', tiger: 'feline', leopard: 'feline',

  horse: 'equid', unicorn: 'equid', zebra: 'equid', deer: 'equid', bison: 'equid',
  cow: 'equid', ox: 'equid', buffalo: 'equid', pig: 'equid', boar: 'equid',
  ram: 'equid', sheep: 'equid', goat: 'equid', camel: 'equid', two_hump_camel: 'equid',
  llama: 'equid', giraffe: 'equid',

  elephant: 'megafauna', mammoth: 'megafauna', rhino: 'megafauna', hippo: 'megafauna',

  mouse: 'rodent', rat: 'rodent', hamster: 'rodent', rabbit: 'rodent',
  chipmunk: 'rodent', beaver: 'rodent', hedgehog: 'rodent', bat: 'rodent',

  bear: 'ursine', polar_bear: 'ursine', koala: 'ursine', panda: 'ursine',
  sloth: 'ursine', otter: 'ursine', skunk: 'ursine', kangaroo: 'ursine', badger: 'ursine',

  turkey: 'avian', chicken: 'avian', rooster: 'avian', chick: 'avian',
  bird: 'avian', penguin: 'avian', dove: 'avian', eagle: 'avian', duck: 'avian',
  swan: 'avian', owl: 'avian', dodo: 'avian', flamingo: 'avian', peacock: 'avian', parrot: 'avian',

  frog: 'reptile', crocodile: 'reptile', turtle: 'reptile', lizard: 'reptile', snake: 'reptile',

  dragon: 'mythic', eastern_dragon: 'mythic', sauropod: 'mythic', t_rex: 'mythic',

  whale: 'marine', spouting_whale: 'marine', dolphin: 'marine', seal: 'marine',
  fish: 'marine', tropical_fish: 'marine', blowfish: 'marine', shark: 'marine', octopus: 'marine',

  nautilus: 'shell', coral: 'shell', crab: 'shell', lobster: 'shell', shrimp: 'shell', squid: 'shell',

  snail: 'insect', butterfly: 'insect', caterpillar: 'insect', ant: 'insect', bee: 'insect',
  beetle: 'insect', ladybug: 'insect', cricket: 'insect', cockroach: 'insect',
  spider: 'insect', scorpion: 'insect', mosquito: 'insect', fly: 'insect', worm: 'insect',
};

export function getFamilyForAnimal(id: AnimalId | string | null | undefined): FamilyId {
  if (!id) return 'botanical';
  return FAMILY_BY_ANIMAL[id as AnimalId] ?? 'botanical';
}
