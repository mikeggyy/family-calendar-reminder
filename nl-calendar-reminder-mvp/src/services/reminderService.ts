import type {
  CreateReminderInput,
  GoogleCalendarConnection,
  Reminder,
} from '../types/reminder';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'http://localhost:3000';
const USER_ID = (import.meta.env.VITE_USER_ID as string | undefined)?.trim() || 'u_demo';
const CLIENT_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  (import.meta.env.VITE_DEFAULT_TIMEZONE as string | undefined)?.trim() ||
  'Asia/Taipei';

type ReminderListItem = {
  event_id: string;
  title: string;
  starts_at: string;
};

const mapListItemToReminder = (item: ReminderListItem): Reminder => ({
  id: item.event_id,
  rawText: item.title,
  title: item.title,
  scheduledAt: item.starts_at,
  createdAt: new Date().toISOString(),
  status: 'active',
});

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
};

export const reminderService = {
  async list(): Promise<Reminder[]> {
    const data = await request<{ items: ReminderListItem[] }>(
      `/api/reminders?userId=${encodeURIComponent(USER_ID)}`,
    );

    const eventMap = new Map<string, Reminder>();
    data.items.forEach((item) => {
      if (!eventMap.has(item.event_id)) {
        eventMap.set(item.event_id, mapListItemToReminder(item));
      }
    });

    return Array.from(eventMap.values()).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  },

  async create(input: CreateReminderInput): Promise<Reminder> {
    const title = input.text.trim() || '未命名提醒';

    const data = await request<{ event: { id: string; title: string; source_text?: string; starts_at: string } }>(
      '/api/reminders',
      {
        method: 'POST',
        body: JSON.stringify({
          userId: USER_ID,
          title,
          text: input.text,
          timezone: CLIENT_TIMEZONE,
        }),
      },
    );

    return {
      id: data.event.id,
      rawText: data.event.source_text || input.text,
      title: data.event.title,
      scheduledAt: data.event.starts_at,
      createdAt: new Date().toISOString(),
      status: 'active',
    };
  },

  async remove(id: string): Promise<void> {
    await request<void>(`/api/reminders/${encodeURIComponent(id)}?userId=${encodeURIComponent(USER_ID)}`, {
      method: 'DELETE',
    });
  },

  async getGoogleCalendarConnection(): Promise<GoogleCalendarConnection> {
    return { connected: false };
  },

  async connectGoogleCalendar(): Promise<GoogleCalendarConnection> {
    await request('/api/integrations/google/connect', {
      method: 'POST',
      body: JSON.stringify({ userId: USER_ID }),
    });

    return {
      connected: true,
      accountEmail: '已連線（MVP）',
    };
  },
};
