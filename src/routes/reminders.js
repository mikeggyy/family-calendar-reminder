import { parseNaturalTime } from '../services/timeParser.js';
import { createEventWithReminders, deleteEventAndReminders, listUserReminders } from '../services/reminderService.js';

function isValidTimeZone(tz) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export default async function reminderRoutes(fastify) {
  fastify.post('/api/reminders', async (req, reply) => {
    const { userId, title, text, timezone } = req.body || {};

    if (!userId || !title || !text) {
      return reply.code(400).send({ error: 'userId, title, text are required' });
    }

    const tz = timezone || process.env.DEFAULT_TIMEZONE || 'Asia/Taipei';
    if (!isValidTimeZone(tz)) {
      return reply.code(400).send({
        error: 'invalid_timezone',
        message: `Invalid timezone: ${tz}`
      });
    }

    const parsed = await parseNaturalTime(text, tz);
    if (!parsed) {
      return reply.code(422).send({
        error: 'time_parse_failed',
        message: 'Unable to parse time expression. Please provide a clearer time.'
      });
    }

    const created = createEventWithReminders({
      userId,
      title,
      sourceText: text,
      startsAt: parsed.startsAt,
      timezone: tz,
      parseMethod: parsed.method
    });

    return reply.code(201).send(created);
  });

  fastify.get('/api/reminders', async (req, reply) => {
    const { userId } = req.query || {};
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    return { items: listUserReminders(userId) };
  });

  fastify.delete('/api/reminders/:eventId', async (req, reply) => {
    const { eventId } = req.params;
    const { userId } = req.query || {};
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    const ok = deleteEventAndReminders(eventId, userId);
    if (!ok) return reply.code(404).send({ error: 'event not found' });

    return reply.code(204).send();
  });
}
