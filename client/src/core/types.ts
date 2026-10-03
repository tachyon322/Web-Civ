// Всё состояние партии — сериализуемые данные без классов и методов,
// чтобы его можно было сохранять, копировать для прогноза и передавать в Web Worker.

export type TerrainId = 'water' | 'plains' | 'rough' | 'mountain';
/** Код местности в map.terrain — индекс в этом массиве. */
export const TERRAINS: readonly TerrainId[] = ['water', 'plains', 'rough', 'mountain'];
export const T_WATER = 0;
export const T_PLAINS = 1;
export const T_ROUGH = 2;
export const T_MOUNTAIN = 3;

export type SpecialId = 'gold' | 'marble' | 'ruins';
/** Код особой клетки в map.special; 0 — обычная клетка. */
export const SPECIALS: readonly (SpecialId | null)[] = [null, 'gold', 'marble', 'ruins'];
export const S_NONE = 0;
export const S_GOLD = 1;
export const S_MARBLE = 2;
export const S_RUINS = 3;

export const NONE = -1;

export interface GameMap {
  width: number;
  height: number;
  terrain: number[];
  special: number[];
  /** Исходные столицы по державам (индекс клетки), нужны для победы завоеванием. */
  starts: number[];
}

export interface Territory {
  /** Держава-владелец клетки или NONE. */
  owner: number[];
  /** Город, к которому привязана клетка, или NONE. */
  city: number[];
}

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Характер бота: задаёт веса его решений. */
export type Character = 'aggressor' | 'trader' | 'diplomat' | 'isolationist';
export const CHARACTERS: readonly Character[] = ['aggressor', 'trader', 'diplomat', 'isolationist'];

export interface Power {
  id: number;
  nationId: string;
  name: string;
  color: string;
  isHuman: boolean;
  /** Характер бота; у игрока — null. */
  character: Character | null;
  alive: boolean;
  gold: number;
  science: number;
  culture: number;
  /** 1 — клетка разведана этой державой. */
  explored: number[];
  capitalId: number;
  /** Сколько имён городов из списка нации уже использовано. */
  cityNamesUsed: number;
  /** Державы, с которыми уже была встреча на карте. */
  met: number[];
  /** Державы, с которыми идёт война (симметрично у обеих сторон). */
  wars: number[];
  /** Сюзерен, если держава — вассал; иначе NONE. */
  suzerain: number;
  /** Что держава помнит о других: подарки, нарушенные договоры, освобождённые города. */
  memories: Memory[];
}

/** Вид памяти — ключ в data/diplomacy.json → memories. */
export type MemoryKind =
  | 'gift'
  | 'culture'
  | 'betrayal'
  | 'betrayalSeen'
  | 'attackedTrader'
  | 'recentWar'
  | 'cityTaken'
  | 'plundered'
  | 'liberated'
  | 'joinedWar'
  | 'tributePaid'
  | 'tributeDemanded'
  | 'tributeRefused'
  | 'treatyCancelled'
  | 'rebellion';

/** Запомненное событие: значение со временем угасает (см. hold и fade в данных). */
export interface Memory {
  /** О ком память. */
  about: number;
  kind: MemoryKind;
  /** Начальное значение для отношений. */
  value: number;
  turn: number;
  /** Подпись вместо стандартной, например «Нарушили договор с Римом». */
  label?: string;
}

export type PactKind = 'war' | 'truce' | 'trade' | 'alliance';

/** Состояние пары держав: война, перемирие, договор или союз. a < b. */
export interface Pact {
  kind: PactKind;
  a: number;
  b: number;
  /** Ход начала. */
  since: number;
  /** Для перемирия — ход, с которого оно уже не действует; иначе 0. */
  until: number;
}

/** Условия мира с точки зрения предлагающего. */
export interface PeaceTerms {
  /** Золото, которое предлагающий платит получателю. */
  giveGold: number;
  /** Город, который предлагающий отдаёт (NONE — нет). */
  giveCity: number;
  /** Золото, которое получатель платит предлагающему. */
  takeGold: number;
  /** Город, который получатель отдаёт предлагающему (NONE — нет). */
  takeCity: number;
  /** Кто становится вассалом другого: NONE, предлагающий или получатель. */
  vassal: number;
}

export type Deal =
  | { kind: 'trade' }
  | { kind: 'alliance' }
  | { kind: 'union' }
  | { kind: 'joinWar'; enemy: number; gold: number }
  | { kind: 'tribute'; gold: number }
  | { kind: 'peace'; terms: PeaceTerms };

export type DealKind = Deal['kind'];

export interface Proposal {
  id: number;
  from: number;
  to: number;
  deal: Deal;
  turn: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
}

export interface City {
  id: number;
  owner: number;
  name: string;
  tile: number;
  level: number;
  growth: number;
  buildings: string[];
  purchasedThisTurn: boolean;
  isCapital: boolean;
  /** Прочность 0..максимум; при 0 город можно захватить. */
  durability: number;
  /** Город атаковали в этом ходу — прочность не восстанавливается. */
  attackedThisTurn: boolean;
  /** Кто основал город — для освобождения после захвата. */
  founder: number;
  /** Ход, начиная с которого город снова можно разграбить (0 — можно сразу). */
  plunderBlockedUntil: number;
}

export type UnitType = 'citizen' | 'warrior' | 'archer' | 'horseman';
export type MilitaryType = Exclude<UnitType, 'citizen'>;
export const MILITARY_TYPES: readonly MilitaryType[] = ['warrior', 'archer', 'horseman'];

export interface Unit {
  id: number;
  owner: number;
  type: UnitType;
  level: number;
  /** Текущая сила — она же здоровье; максимум равен числу людей в юните. */
  strength: number;
  /** Звёзды ветерана, 0..3. */
  stars: number;
  tile: number;
  mp: number;
  /** Цель многоходового маршрута или NONE. */
  routeTarget: number;
  /** Двигался или действовал в этом ходу. */
  moved: boolean;
  /** Не двигался весь прошлый ход — бонус к защите. */
  fortified: boolean;
}

export interface LogEntry {
  turn: number;
  /** Кого касается запись; NONE — всех (или тех, кто в audience). */
  power: number;
  text: string;
  /** Если задано — запись видят только эти державы. */
  audience?: number[];
}

export interface GameSettings {
  seed: number;
  powers: number;
  /** Нация игрока; null — случайная. */
  humanNation: string | null;
  difficulty: Difficulty;
}

export interface GameState {
  version: 1;
  settings: GameSettings;
  turn: number;
  humanPower: number;
  map: GameMap;
  territory: Territory;
  powers: Power[];
  cities: City[];
  units: Unit[];
  /** Войны, перемирия, договоры и союзы между парами держав. */
  pacts: Pact[];
  /** Предложения игроку (ждут ответа) и недавние ответы. */
  proposals: Proposal[];
  /** Держава, против которой собирается коалиция (близка к победе), или NONE. */
  coalitionLeader: number;
  nextId: number;
  log: LogEntry[];
}
