export type ReminderStatus = 'active' | 'done';

export interface Reminder {
  id: string;
  rawText: string;
  title: string;
  scheduledAt: string;
  createdAt: string;
  status: ReminderStatus;
}

export interface CreateReminderInput {
  text: string;
}

export interface GoogleCalendarConnection {
  connected: boolean;
  accountEmail?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
}

export interface GoogleSyncResult {
  synced: number;
  items: Array<{
    eventId: string;
    status: 'synced' | 'failed';
    googleEventId?: string | null;
    message?: string;
  }>;
}
