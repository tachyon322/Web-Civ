// Покупки бота: в каждом городе не больше одной за ход. Кандидаты собираются в один список
// с приоритетами; на важное (стены, казармы), если валюты пока нет, бот копит —
// менее важные покупки не трогают отложенное. Доход после покупки не уходит ниже порога.
// Специалистов (учёных, мастеров) бот покупает за науку и культуру, если их хватает сверх запаса
// на способности и этап финального проекта, иначе — за золото.

import type { Command } from '../core/commands';
import { buildingBlocker } from '../core/buildings';
import { improvableTiles, improvementPrice } from '../core/improvements';
import { specialistPrice } from '../core/specialists';
import { aiConfig, buildingDef, buildings, specialistDefs, type BuildingDef, type Currency } from '../core/data';
import { buildingPrice, citizenPrice, militaryPrice } from '../core/economy';
import { distance } from '../core/hex';
import { cityUnitLevel, citySlots, hasBuildingEffect, mapSize, peopleAtLevel, specialistCount, usedSlots } from '../core/state';
import { SPECIALIST_KINDS, type GameState, type SpecialistKind } from '../core/types';
import type { City, MilitaryType } from '../core/types';
import {
  atWarWithAnyone,
  exec,
  goldIncome,
  knownForeignCities,
  myCities,
  outOfTime,
  threatNear,
  type BotContext,
} from './context';
import { pathReserve } from './paths';

export interface PurchasePlan {
  /** Сколько силы армии не хватает. */
  armyNeed: number;
  /** Сколько жителей докупить. */
  citizensWanted: number;
  /** Золото, которое держим на основание города. */
  reserve: number;
  unitType: MilitaryType;
}

interface Candidate {
  city: City;
  priority: number;
  price: number;
  /** Изменение дохода (содержание нового юнита). */
  upkeep: number;
  /** Копить на эту покупку, если пока не хватает. */
  saveFor: boolean;
  kind: 'walls' | 'barracks' | 'military' | 'recruit' | 'citizen' | 'building' | 'specialist';
  currency: Currency;
  cmd: Command;
}

/** Исходное здание цепочки улучшений: университет → библиотека. */
function rootBuilding(id: string): string {
  let def = buildingDef(id);
  while (def.upgradeOf) def = buildingDef(def.upgradeOf);
  return def.id;
}

function hasFreeSlot(state: GameState, city: City): boolean {
  return usedSlots(city) < citySlots(state, city);
}

/** Какая линия зданий кормит специалиста этого вида (для весов характера). */
const SPECIALIST_LINE: Record<SpecialistKind, string> = { scientist: 'library', artisan: 'temple', merchant: 'market' };

/** Следующий шаг цепочки улучшений эффекта (стены → крепость, казармы → академия), если его можно купить. */
function effectUpgrade(ctx: BotContext, city: City, effect: 'walls' | 'barracks'): BuildingDef | null {
  const current = city.buildings.find((b) => buildingDef(b).effect === effect);
  const next = current ? buildings.find((b) => b.upgradeOf === current) : undefined;
  return next && !buildingBlocker(ctx.state, ctx.power, city, next) ? next : null;
}

/** Пограничный город: рядом известный город державы, с которой идёт война. */
function frontier(ctx: BotContext, city: City): boolean {
  const size = mapSize(ctx.state);
  const wars = ctx.state.powers[ctx.power].wars;
  return knownForeignCities(ctx).some((c) => wars.includes(c.owner) && distance(size, c.tile, city.tile) <= aiConfig.war.reach);
}

function candidates(ctx: BotContext, plan: PurchasePlan, keep: Record<Currency, number>): Candidate[] {
  const { state, power } = ctx;
  const war = atWarWithAnyone(ctx);
  const cities = myCities(ctx);
  const anyBarracks = cities.some((c) => hasBuildingEffect(c, 'barracks'));
  const list: Candidate[] = [];
  const weights = ctx.character.buildings as Record<string, number>;

  for (const city of cities) {
    if (city.purchasedThisTurn) continue;
    const threat = threatNear(ctx, city.tile, aiConfig.military.threatRadius + 1);
    const free = hasFreeSlot(state, city);
    const wallsPrice = buildingPrice(state, power, 'walls');
    const endangered = threat > 0 || (war && frontier(ctx, city));
    if (free && !hasBuildingEffect(city, 'walls') && endangered) {
      const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: 'walls' };
      list.push({ city, priority: 100 + threat, price: wallsPrice, upkeep: 0, saveFor: true, kind: 'walls', currency: 'gold', cmd });
    }
    // Крепость и бастион — только при враге рядом, а не на всякий случай.
    const walls = threat > 0 ? effectUpgrade(ctx, city, 'walls') : null;
    if (walls) {
      const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: walls.id };
      list.push({ city, priority: 85 + threat, price: buildingPrice(state, power, walls.id), upkeep: 0, saveFor: true, kind: 'walls', currency: 'gold', cmd });
    }
    if (plan.armyNeed > 0) {
      const level = cityUnitLevel(city);
      const academy = level && (war || weights.barracks >= 1.2) ? effectUpgrade(ctx, city, 'barracks') : null;
      if (academy) {
        const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: academy.id };
        list.push({ city, priority: 60, price: buildingPrice(state, power, academy.id), upkeep: 0, saveFor: false, kind: 'barracks', currency: 'gold', cmd });
      }
      if (level) {
        const cmd: Command = { type: 'BuyMilitary', power, cityId: city.id, unitType: plan.unitType };
        const people = peopleAtLevel(level);
        list.push({ city, priority: 70 + threat, price: militaryPrice(state, power, level), upkeep: people, saveFor: war, kind: 'military', currency: 'gold', cmd });
      } else if (!anyBarracks && free && city.level >= 2 && (war || weights.barracks >= 1.2)) {
        const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: 'barracks' };
        list.push({ city, priority: 80, price: buildingPrice(state, power, 'barracks'), upkeep: 0, saveFor: true, kind: 'barracks', currency: 'gold', cmd });
      } else {
        const cmd: Command = { type: 'BuyCitizen', power, cityId: city.id };
        list.push({ city, priority: 50 + threat, price: citizenPrice(state, power), upkeep: 1, saveFor: false, kind: 'recruit', currency: 'gold', cmd });
      }
    }
    if (plan.citizensWanted > 0) {
      const cmd: Command = { type: 'BuyCitizen', power, cityId: city.id };
      list.push({ city, priority: 40 + city.level, price: citizenPrice(state, power), upkeep: 1, saveFor: false, kind: 'citizen', currency: 'gold', cmd });
    }
    // Здания, улучшения (в том же слоте) и чудеса: чем желаннее по характеру и дешевле, тем раньше.
    // При низкой стабильности храмы, театры и музеи идут вперёд.
    const lowStability = state.powers[power].stability < aiConfig.paths.minStabilityToExpand;
    for (const b of buildings) {
      if (b.effect || buildingBlocker(state, power, city, b)) continue;
      // Школа и мастерская окупаются только при нескольких специалистах.
      if (b.perSpecialist && city.specialists[b.perSpecialist.kind] < aiConfig.economy.specialistsForSchool) continue;
      const price = buildingPrice(state, power, b.id, city);
      const root = rootBuilding(b.requires?.building ?? b.id);
      const weight = b.wonder ? ctx.character.wonders : (weights[root] ?? 1) * (b.national ? aiConfig.economy.nationalWeight : 1);
      const calming = lowStability && (b.stability ?? 0) > 0 && !b.wonder ? aiConfig.paths.templeBoost : 0;
      const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: b.id };
      const value = ((weight * 100) / price) * (b.wonder ? aiConfig.paths.wonderPriority : 1);
      const save = calming > 0 || (!!b.wonder && weight >= aiConfig.paths.wonderSaveWeight);
      list.push({ city, priority: 20 + calming + value, price, upkeep: 0, saveFor: save, kind: 'building', currency: 'gold', cmd });
    }
    // Сооружения на особых клетках города.
    for (const tile of improvableTiles(state, city)) {
      const price = improvementPrice(state, power, tile);
      const cmd: Command = { type: 'BuyImprovement', power, cityId: city.id, tile };
      list.push({ city, priority: 20 + (aiConfig.economy.improvementWeight * 100) / price, price, upkeep: 0, saveFor: false, kind: 'building', currency: 'gold', cmd });
    }
    // Специалист: вид — по характеру и по школе или мастерской в городе; валюта — своя, если хватает.
    if (specialistCount(city) < city.level) {
      const p = state.powers[power];
      const score = (k: SpecialistKind) =>
        (weights[SPECIALIST_LINE[k]] ?? 1) + (city.buildings.some((b) => buildingDef(b).perSpecialist?.kind === k) ? aiConfig.economy.specialistSynergy : 0);
      const kind = [...SPECIALIST_KINDS].sort((a, b) => score(b) - score(a))[0];
      const price = specialistPrice(state, power, kind);
      const own = specialistDefs[kind].currencies.find((c) => c !== 'gold' && p[c] - keep[c] >= price);
      const currency: Currency = own ?? 'gold';
      const cmd: Command = { type: 'BuySpecialist', power, cityId: city.id, kind, currency };
      list.push({ city, priority: 20 + (score(kind) * 100) / price, price, upkeep: 0, saveFor: false, kind: 'specialist', currency, cmd });
    }
  }
  return list.sort((a, b) => b.priority - a.priority || a.city.id - b.city.id);
}

export function purchasesTurn(ctx: BotContext, plan: PurchasePlan): void {
  const { state, power } = ctx;
  const p = state.powers[power];
  const minIncome = atWarWithAnyone(ctx) ? 0 : aiConfig.economy.minIncomeAfterPurchase;
  let income = goldIncome(ctx);
  let { armyNeed, citizensWanted } = plan;
  // Отложенное: на важные покупки, которые пока не по карману.
  const saved: Record<Currency, number> = { gold: 0, science: 0, culture: 0 };
  // Наука и культура: запас на этап проекта и на способности.
  const keep: Record<Currency, number> = {
    gold: plan.reserve,
    science: pathReserve(ctx, 'science') + aiConfig.paths.abilityReserve,
    culture: pathReserve(ctx, 'culture') + aiConfig.paths.abilityReserve,
  };

  for (const c of candidates(ctx, plan, keep)) {
    if (outOfTime(ctx)) return;
    if (c.city.purchasedThisTurn) continue;
    if ((c.kind === 'military' || c.kind === 'recruit') && armyNeed <= 0) continue;
    if (c.kind === 'citizen' && citizensWanted <= 0) continue;
    if (income - c.upkeep < minIncome) continue;
    // Армию и стены не держит резерв на основание города.
    const urgent = c.kind === 'walls' || c.kind === 'military' || c.kind === 'barracks' || c.kind === 'recruit';
    const available = p[c.currency] - saved[c.currency] - (urgent ? 0 : keep[c.currency]);
    if (available < c.price) {
      if (c.saveFor) saved[c.currency] += c.price;
      continue;
    }
    if (!exec(ctx, c.cmd)) continue;
    income -= c.upkeep;
    if (c.kind === 'military') armyNeed -= c.upkeep;
    if (c.kind === 'recruit') armyNeed -= 1;
    if (c.kind === 'citizen') citizensWanted--;
  }
}
