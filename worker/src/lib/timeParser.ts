import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const WEEKDAY_MAP: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const PERIOD_RE = '(凌晨|早上|上午|中午|下午|晚上)';
const HOUR_RE = '(?:\\d{1,2}|[零一二兩三四五六七八九十]{1,3})';
const MINUTE_RE = '(?:\\d{1,2}|[零一二兩三四五六七八九十]{1,3})';

function parseChineseNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const txt = String(raw);
  if (/^\d+$/.test(txt)) return Number(txt);
  const digitMap: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (txt === '十') return 10;
  if (txt.startsWith('十')) return 10 + (digitMap[txt.slice(1)] ?? 0);
  const tenIndex = txt.indexOf('十');
  if (tenIndex > 0) return (digitMap[txt.slice(0, tenIndex)] ?? 0) * 10 + (txt.slice(tenIndex + 1) ? digitMap[txt.slice(tenIndex + 1)] ?? 0 : 0);
  return digitMap[txt] ?? null;
}

function applyHourByPeriod(base: dayjs.Dayjs, period?: string, hourRaw: unknown = 9, minuteRaw: unknown = 0) {
  let hour = parseChineseNumber(hourRaw) ?? 9;
  const minute = parseChineseNumber(minuteRaw) ?? 0;
  if ((period === '下午' || period === '晚上') && hour < 12) hour += 12;
  if ((period === '早上' || period === '上午' || period === '凌晨') && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return base.hour(hour).minute(minute).second(0).millisecond(0);
}

function parseByRules(text: string, tz: string) {
  const raw = text.trim();
  const isoLike = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:?\d{2})?$/;
  if (isoLike.test(raw)) {
    const iso = dayjs.tz(raw, tz);
    if (iso.isValid()) return { startsAt: iso.toISOString(), method: 'rule_iso' };
  }

  // Fuzzy patterns embedded in reminder sentences, e.g. "提醒我 3/10 9:00 到職"
  const relClock = raw.match(new RegExp(`(今天|明天|後天)\\s*${PERIOD_RE}?\\s*(${HOUR_RE})(?::(${MINUTE_RE}))?`));
  if (relClock) {
    const [, dayText, period, hour, minute] = relClock;
    const offset = dayText === '今天' ? 0 : dayText === '明天' ? 1 : 2;
    const base = applyHourByPeriod(dayjs().tz(tz).add(offset, 'day'), period, hour || 9, minute || 0);
    if (!base) return null;
    return { startsAt: base.toISOString(), method: 'rule_relative_day' };
  }

  const nextWeekClock = raw.match(new RegExp(`下週([一二三四五六日天])\\s*${PERIOD_RE}?\\s*(${HOUR_RE})(?::(${MINUTE_RE}))?`));
  if (nextWeekClock) {
    const [, wdTxt, period, hour, minute] = nextWeekClock;
    const now = dayjs().tz(tz);
    const delta = ((WEEKDAY_MAP[wdTxt] - now.day() + 7) % 7) + 7;
    const dt = applyHourByPeriod(now.add(delta, 'day'), period, hour || 9, minute || 0);
    if (!dt) return null;
    return { startsAt: dt.toISOString(), method: 'rule_next_weekday' };
  }

  const mdClock = raw.match(new RegExp(`(\\d{1,2})[\\/-](\\d{1,2})\\s*${PERIOD_RE}?\\s*(${HOUR_RE})(?::(${MINUTE_RE}))?`));
  if (mdClock) {
    const [, monthRaw, dayRaw, period, hour, minute] = mdClock;
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const now = dayjs().tz(tz);
    let year = now.year();
    let dt = dayjs.tz(`${year}-${month}-${day}`, 'YYYY-M-D', tz);
    if (!dt.isValid() || dt.month() + 1 !== month || dt.date() !== day) return null;
    if (dt.endOf('day').isBefore(now)) {
      year += 1;
      dt = dayjs.tz(`${year}-${month}-${day}`, 'YYYY-M-D', tz);
      if (!dt.isValid() || dt.month() + 1 !== month || dt.date() !== day) return null;
    }

    const withTime = applyHourByPeriod(dt, period, hour || 9, minute || 0);
    if (!withTime) return null;
    return { startsAt: withTime.toISOString(), method: 'rule_month_day' };
  }

  const rel = raw.match(new RegExp(`^(今天|明天|後天)\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?$`));
  if (rel) {
    const [, dayText, period, hour, minute] = rel;
    const offset = dayText === '今天' ? 0 : dayText === '明天' ? 1 : 2;
    const base = applyHourByPeriod(dayjs().tz(tz).add(offset, 'day'), period, hour || 9, minute || 0);
    if (!base) return null;
    return { startsAt: base.toISOString(), method: 'rule_relative_day' };
  }

  const nextWeek = raw.match(new RegExp(`^下週([一二三四五六日天])\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?$`));
  if (nextWeek) {
    const [, wdTxt, period, hour, minute] = nextWeek;
    const now = dayjs().tz(tz);
    const delta = ((WEEKDAY_MAP[wdTxt] - now.day() + 7) % 7) + 7;
    const dt = applyHourByPeriod(now.add(delta, 'day'), period, hour || 9, minute || 0);
    if (!dt) return null;
    return { startsAt: dt.toISOString(), method: 'rule_next_weekday' };
  }

  const md = raw.match(new RegExp(`^(\\d{1,2})[\\/-](\\d{1,2})\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?$`));
  if (md) {
    const [, monthRaw, dayRaw, period, hour, minute] = md;
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const now = dayjs().tz(tz);
    let year = now.year();
    let dt = dayjs.tz(`${year}-${month}-${day}`, 'YYYY-M-D', tz);
    if (!dt.isValid() || dt.month() + 1 !== month || dt.date() !== day) return null;
    if (dt.endOf('day').isBefore(now)) {
      year += 1;
      dt = dayjs.tz(`${year}-${month}-${day}`, 'YYYY-M-D', tz);
      if (!dt.isValid() || dt.month() + 1 !== month || dt.date() !== day) return null;
    }

    dt = applyHourByPeriod(dt, period, hour || 9, minute || 0)!;
    if (dt?.isValid()) return { startsAt: dt.toISOString(), method: 'rule_month_day' };
  }

  return null;
}

export async function parseNaturalTime(text: string, tz = 'Asia/Taipei') {
  const raw = text.trim();
  return parseByRules(raw, tz);
}
