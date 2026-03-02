import { parseNaturalTime } from '../src/services/timeParser.js';

const cases = [
  '提醒我明天下午三點開會',
  '請在下週二早上9點提醒我交報告',
  '3/15 下午2點開會提醒',
  '明天晚上8點',
  '下週五',
  '2026-03-20 14:30',
  '2026-03-20T14:30:00+08:00'
];

(async () => {
  console.log('Time parser quick check:\n');
  for (const text of cases) {
    const parsed = await parseNaturalTime(text, 'Asia/Taipei');
    console.log(`- ${text}`);
    console.log(`  => ${parsed ? `${parsed.startsAt} (${parsed.method})` : 'null'}`);
  }
})();
