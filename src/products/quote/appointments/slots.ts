import { addDays, atLagos, lagos, weekdayOf, type Day } from "./times.js";

// Works out the free times for a service. No database, so it can be tested
// on its own; the store loads everything it needs first.
//
// One-to-one sessions: every calendar that does the service offers times
// through its weekly hours, a session length apart (15 minutes at least, an
// hour at most, so a 2-hour massage can start on any hour). A time is free
// when that calendar has no booking, block or class of its own then.
// Group classes: the class's set times each week, while places are left.
// Nothing sooner than the owner's notice, nothing past the days ahead.

export interface Service {
  variantId: string;
  minutes: number;
  /** 1: one-to-one. More: a group class with this many places. */
  places: number;
}

export interface Calendar {
  id: string;
  name: string;
  /** The services this person does; empty for all. */
  services: string[];
  /** Weekday (0 = Sunday) to working hours in minutes after midnight. */
  hours: Map<number, { start: number; end: number }>;
}

export interface ClassTime {
  variantId: string;
  calendarId: string | null;
  weekday: number;
  startMinute: number;
  /** How long the class runs. */
  minutes: number;
}

export interface Block {
  calendarId: string | null;
  start: Date;
  end: Date;
}

/** A booking that takes up time: booked, or held and still waiting to be paid. */
export interface Busy {
  variantId: string;
  calendarId: string | null;
  start: Date;
  end: Date;
  places: number;
}

export interface Rules {
  /** No bookings sooner than this many hours from now. */
  noticeHours: number;
  /** No bookings more than this many days ahead. */
  daysAhead: number;
}

export interface SlotInput {
  service: Service;
  calendars: Calendar[];
  classTimes: ClassTime[];
  blocks: Block[];
  busy: Busy[];
  rules: Rules;
  now: Date;
}

export interface Slot {
  start: Date;
  end: Date;
  /** One-to-one: the calendars free then, in the owner's order. A class: who takes it, if anyone. */
  calendars: Array<{ id: string; name: string }>;
  /** A class: places left. Null for one-to-one. */
  left: number | null;
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && a.end > b.start;

export function canDo(calendar: Calendar, variantId: string): boolean {
  return calendar.services.length === 0 || calendar.services.includes(variantId);
}

/** The free times on one day, earliest first. `only` narrows one-to-one times to one calendar. */
export function slotsOn(input: SlotInput, day: Day, only?: string | null): Slot[] {
  const { service, now, rules } = input;
  const earliest = new Date(now.getTime() + rules.noticeHours * 3_600_000);
  const lastDay = addDays(lagos(now).day, rules.daysAhead);
  if (day < lagos(now).day || day > lastDay) return [];
  const weekday = weekdayOf(day);
  const blocked = (calendarId: string | null, span: { start: Date; end: Date }) =>
    input.blocks.some((b) => (b.calendarId === null || b.calendarId === calendarId) && overlaps(b, span));

  if (service.places > 1) {
    return input.classTimes
      .filter((c) => c.variantId === service.variantId && c.weekday === weekday)
      .map((c) => {
        const start = atLagos(day, c.startMinute);
        const end = new Date(start.getTime() + service.minutes * 60_000);
        const taken = input.busy.filter((b) => b.variantId === service.variantId && b.start.getTime() === start.getTime()).reduce((n, b) => n + b.places, 0);
        const who = c.calendarId ? input.calendars.find((cal) => cal.id === c.calendarId) : undefined;
        return { start, end, calendars: who ? [{ id: who.id, name: who.name }] : [], left: service.places - taken };
      })
      .filter((s) => s.start >= earliest && s.left > 0 && !blocked(s.calendars[0]?.id ?? null, s))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  const step = Math.min(60, Math.max(15, service.minutes));
  const byStart = new Map<number, Slot>();
  for (const cal of input.calendars) {
    if (!canDo(cal, service.variantId) || (only && cal.id !== only)) continue;
    const hours = cal.hours.get(weekday);
    if (!hours) continue;
    // Classes this person takes keep them busy, booked or not.
    const classes = input.classTimes
      .filter((c) => c.calendarId === cal.id && c.weekday === weekday)
      .map((c) => ({ start: atLagos(day, c.startMinute), end: atLagos(day, c.startMinute + c.minutes) }));
    for (let m = hours.start; m + service.minutes <= hours.end; m += step) {
      const span = { start: atLagos(day, m), end: atLagos(day, m + service.minutes) };
      if (span.start < earliest || blocked(cal.id, span)) continue;
      if (classes.some((c) => overlaps(c, span))) continue;
      if (input.busy.some((b) => b.calendarId === cal.id && overlaps(b, span))) continue;
      const slot = byStart.get(span.start.getTime()) ?? { ...span, calendars: [], left: null };
      slot.calendars.push({ id: cal.id, name: cal.name });
      byStart.set(span.start.getTime(), slot);
    }
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The days from today with at least one free time, soonest first, up to `max`. */
export function openDays(input: SlotInput, max: number, only?: string | null): Array<{ day: Day; count: number }> {
  const today = lagos(input.now).day;
  const days: Array<{ day: Day; count: number }> = [];
  for (let i = 0; i <= input.rules.daysAhead && days.length < max; i++) {
    const day = addDays(today, i);
    const count = slotsOn(input, day, only).length;
    if (count) days.push({ day, count });
  }
  return days;
}
