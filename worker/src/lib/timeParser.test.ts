import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { parseNaturalTime } from './timeParser.ts';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Taipei';

function toLocal(iso: string) {
  return dayjs(iso).tz(TZ);
}

test('fuzzy month/day phrase keeps minute 00: 3/10 09:00 報到', async () => {
  const parsed = await parseNaturalTime('3/10 09:00 報到', TZ);
  assert.ok(parsed, 'should parse month/day fuzzy phrase');

  const local = toLocal(parsed!.startsAt);
  assert.equal(local.format('MM/DD HH:mm'), '03/10 09:00');
  assert.equal(parsed!.method, 'rule_month_day');
});

test('existing phrase still works: 明天下午三點', async () => {
  const now = dayjs().tz(TZ);
  const parsed = await parseNaturalTime('明天下午三點', TZ);
  assert.ok(parsed, 'should parse relative day phrase');

  const local = toLocal(parsed!.startsAt);
  assert.equal(local.hour(), 15);
  assert.equal(local.minute(), 0);
  assert.equal(local.format('YYYY-MM-DD'), now.add(1, 'day').format('YYYY-MM-DD'));
});

test('existing phrase still works: 下週二早上9點', async () => {
  const now = dayjs().tz(TZ);
  const parsed = await parseNaturalTime('下週二早上9點', TZ);
  assert.ok(parsed, 'should parse next-week weekday phrase');

  const local = toLocal(parsed!.startsAt);
  const expectedDelta = ((2 - now.day() + 7) % 7) + 7;
  assert.equal(local.format('YYYY-MM-DD'), now.add(expectedDelta, 'day').format('YYYY-MM-DD'));
  assert.equal(local.hour(), 9);
  assert.equal(local.minute(), 0);
});
