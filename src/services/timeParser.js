import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const WEEKDAY_MAP = {
  '日': 0,
  '天': 0,
  '一': 1,
  '二': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6
};

const PERIOD_RE = '(凌晨|早上|上午|中午|下午|晚上)';
const HOUR_RE = '(\\d{1,2}|[零一二兩三四五六七八九十]{1,3})';
const MINUTE_RE = '(\\d{1,2}|[零一二兩三四五六七八九十]{1,3})';

function parseChineseNumber(raw) {
  if (raw == null || raw === '') return null;
  const txt = String(raw);
  if (/^\d+$/.test(txt)) return Number(txt);

  const digitMap = {
    '零': 0,
    '一': 1,
    '二': 2,
    '兩': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9
  };

  if (txt === '十') return 10;
  if (txt.startsWith('十')) {
    const ones = digitMap[txt.slice(1)] ?? 0;
    return 10 + ones;
  }

  const tenIndex = txt.indexOf('十');
  if (tenIndex > 0) {
    const tens = digitMap[txt.slice(0, tenIndex)] ?? 0;
    const onesTxt = txt.slice(tenIndex + 1);
    const ones = onesTxt ? (digitMap[onesTxt] ?? 0) : 0;
    return tens * 10 + ones;
  }

  if (digitMap[txt] != null) return digitMap[txt];
  return null;
}

function toHour(hourRaw) {
  const hour = parseChineseNumber(hourRaw);
  if (hour == null) return 9;
  return hour;
}

function toMinute(minuteRaw) {
  const minute = parseChineseNumber(minuteRaw);
  if (minute == null) return 0;
  return minute;
}

function applyHourByPeriod(base, period, hourRaw, minuteRaw = 0) {
  let hour = toHour(hourRaw);
  const minute = toMinute(minuteRaw);

  if (period === '下午' || period === '晚上') {
    if (hour < 12) hour += 12;
  }
  if ((period === '早上' || period === '上午' || period === '凌晨') && hour === 12) {
    hour = 0;
  }

  return base.hour(hour).minute(minute).second(0).millisecond(0);
}

function extractTimeSegment(text) {
  const raw = text.trim();

  const patterns = [
    new RegExp(`(今天|明天|後天)\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?`),
    new RegExp(`下週[一二三四五六日天]\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?`),
    new RegExp(`\\d{1,2}[\\/-]\\d{1,2}\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?`),
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:?\d{2})?$/,
    /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}$/
  ];

  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m) return m[0].trim();
  }

  return raw;
}

function parseByRules(text, tz) {
  const raw = text.trim();

  const isoLike = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:?\d{2})?$/;
  if (isoLike.test(raw)) {
    const iso = dayjs.tz(raw, tz);
    if (iso.isValid()) return { startsAt: iso.toISOString(), method: 'rule_iso' };
  }

  const ymdhm = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (ymdhm) {
    const [, y, m, d, h, mm] = ymdhm;
    const dt = dayjs.tz(`${y}-${m}-${d} ${h}:${mm}`, 'YYYY-M-D H:mm', tz);
    if (dt.isValid()) return { startsAt: dt.toISOString(), method: 'rule_ymdhm' };
  }

  const rel = raw.match(new RegExp(`^(今天|明天|後天)\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?$`));
  if (rel) {
    const [, dayText, period, hour, minute] = rel;
    const offset = dayText === '今天' ? 0 : dayText === '明天' ? 1 : 2;
    let base = dayjs().tz(tz).add(offset, 'day');
    base = applyHourByPeriod(base, period, hour || 9, minute || 0);
    return { startsAt: base.toISOString(), method: 'rule_relative_day' };
  }

  const nextWeek = raw.match(new RegExp(`^下週([一二三四五六日天])\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?$`));
  if (nextWeek) {
    const [, wdTxt, period, hour, minute] = nextWeek;
    const target = WEEKDAY_MAP[wdTxt];
    const now = dayjs().tz(tz);
    const current = now.day();
    const delta = ((target - current + 7) % 7) + 7;
    let dt = now.add(delta, 'day');
    dt = applyHourByPeriod(dt, period, hour || 9, minute || 0);
    return { startsAt: dt.toISOString(), method: 'rule_next_weekday' };
  }

  const md = raw.match(new RegExp(`^(\\d{1,2})[\\/-](\\d{1,2})\\s*${PERIOD_RE}?\\s*${HOUR_RE}?點?(?:\\s*${MINUTE_RE}分?)?$`));
  if (md) {
    const [, month, day, period, hour, minute] = md;
    const now = dayjs().tz(tz);
    let year = now.year();
    let dt = dayjs.tz(`${year}-${month}-${day}`, 'YYYY-M-D', tz);

    // 若當年日期已過，推到下一年
    if (dt.endOf('day').isBefore(now)) {
      year += 1;
      dt = dayjs.tz(`${year}-${month}-${day}`, 'YYYY-M-D', tz);
    }

    dt = applyHourByPeriod(dt, period, hour || 9, minute || 0);
    if (dt.isValid()) return { startsAt: dt.toISOString(), method: 'rule_month_day' };
  }

  return null;
}

async function parseByLLM(text, tz) {
  // Placeholder: connect your LLM provider here.
  // Expected return: ISO string in UTC.
  if (!process.env.OPENAI_API_KEY) return null;

  // In MVP we keep a safe stub, no outbound call yet.
  // Return null to indicate unresolved.
  return null;
}

export async function parseNaturalTime(text, tz = 'Asia/Taipei') {
  const raw = text.trim();

  // 先跑既有規則，避免原本可解析格式被新抽取邏輯誤傷。
  const byRawRule = parseByRules(raw, tz);
  if (byRawRule) return byRawRule;

  // 若整句無法解析，再抽取時間片段套用既有規則。
  const timeSegment = extractTimeSegment(raw);
  if (timeSegment !== raw) {
    const bySegmentRule = parseByRules(timeSegment, tz);
    if (bySegmentRule) return bySegmentRule;
  }

  const byLLM = await parseByLLM(text, tz);
  if (byLLM) return { startsAt: byLLM, method: 'llm' };

  return null;
}
