// Покупки бота: в каждом городе не больше одной за ход. Кандидаты собираются в один список
// с приоритетами; на важное (стены, казармы), если золота пока нет, бот копит —
// менее важные покупки не трогают отложенное. Доход после покупки не уходит ниже порога.

import type { Command } from '../core/commands';
import { aiConfig, buildings } from '../core/data';
import { buildingPrice, citizenPrice, militaryPrice } from '../core/economy';
import { distance } from '../core/hex';
import { citySlots, hasBuildingEffect, mapSize } from '../core/state';
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
  kind: 'walls' | 'barracks' | 'military' | 'recruit' | 'citizen' | 'building';
  cmd: Command;
}

const LEVEL2_PEOPLE = 2;

function hasFreeSlot(city: City): boolean {
  return city.buildings.length < citySlots(city);
}

/** Пограничный город: рядом известный город державы, с которой идёт война. */
function frontier(ctx: BotContext, city: City): boolean {
  const size = mapSize(ctx.state);
  const wars = ctx.state.powers[ctx.power].wars;
  return knownForeignCities(ctx).some((c) => wars.includes(c.owner) && distance(size, c.tile, city.tile) <= aiConfig.war.reach);
}

function candidates(ctx: BotContext, plan: PurchasePlan): Candidate[] {
  const { state, power } = ctx;
  const war = atWarWithAnyone(ctx);
  const cities = myCities(ctx);
  const anyBarracks = cities.some((c) => hasBuildingEffect(c, 'barracks'));
  const list: Candidate[] = [];
  const weights = ctx.character.buildings as Record<string, number>;

  for (const city of cities) {
    if (city.purchasedThisTurn) continue;
    const threat = threatNear(ctx, city.tile, aiConfig.military.threatRadius + 1);
    const free = hasFreeSlot(city);
    const wallsPrice = buildingPrice(state, power, 'walls');
    if (free && !hasBuildingEffect(city, 'walls') && (threat > 0 || (war && frontier(ctx, city)))) {
      const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: 'walls' };
      list.push({ city, priority: 100 + threat, price: wallsPrice, upkeep: 0, saveFor: true, kind: 'walls', cmd });
    }
    if (plan.armyNeed > 0) {
      if (hasBuildingEffect(city, 'barracks')) {
        const cmd: Command = { type: 'BuyMilitary', power, cityId: city.id, unitType: plan.unitType };
        list.push({ city, priority: 70 + threat, price: militaryPrice(state, power), upkeep: LEVEL2_PEOPLE, saveFor: war, kind: 'military', cmd });
      } else if (!anyBarracks && free && city.level >= 2 && (war || weights.barracks >= 1.2)) {
        const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: 'barracks' };
        list.push({ city, priority: 80, price: buildingPrice(state, power, 'barracks'), upkeep: 0, saveFor: true, kind: 'barracks', cmd });
      } else {
        const cmd: Command = { type: 'BuyCitizen', power, cityId: city.id };
        list.push({ city, priority: 50 + threat, price: citizenPrice(state, power), upkeep: 1, saveFor: false, kind: 'recruit', cmd });
      }
    }
    if (plan.citizensWanted > 0) {
      const cmd: Command = { type: 'BuyCitizen', power, cityId: city.id };
      list.push({ city, priority: 40 + city.level, price: citizenPrice(state, power), upkeep: 1, saveFor: false, kind: 'citizen', cmd });
    }
    if (free) {
      for (const b of buildings) {
        if (city.buildings.includes(b.id) || b.effect) continue;
        const price = buildingPrice(state, power, b.id);
        const cmd: Command = { type: 'BuyBuilding', power, cityId: city.id, buildingId: b.id };
        // Чем желаннее по характеру и дешевле, тем раньше.
        list.push({ city, priority: 20 + (weights[b.id] ?? 1) * 100 / price, price, upkeep: 0, saveFor: false, kind: 'building', cmd });
      }
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
  // Отложенное золото: на важные покупки, которые пока не по карману.
  let saved = 0;

  for (const c of candidates(ctx, plan)) {
    if (outOfTime(ctx)) return;
    if (c.city.purchasedThisTurn) continue;
    if ((c.kind === 'military' || c.kind === 'recruit') && armyNeed <= 0) continue;
    if (c.kind === 'citizen' && citizensWanted <= 0) continue;
    if (income - c.upkeep < minIncome) continue;
    // Армию и стены не держит резерв на основание города.
    const urgent = c.kind === 'walls' || c.kind === 'military' || c.kind === 'barracks' || c.kind === 'recruit';
    const available = p.gold - saved - (urgent ? 0 : plan.reserve);
    if (available < c.price) {
      if (c.saveFor) saved += c.price;
      continue;
    }
    if (!exec(ctx, c.cmd)) continue;
    income -= c.upkeep;
    if (c.kind === 'military') armyNeed -= LEVEL2_PEOPLE;
    if (c.kind === 'recruit') armyNeed -= 1;
    if (c.kind === 'citizen') citizensWanted--;
  }
}
