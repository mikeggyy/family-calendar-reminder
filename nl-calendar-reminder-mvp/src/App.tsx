import { useEffect, useState } from 'react';
import GoogleCalendarConnectButton from './components/GoogleCalendarConnectButton';
import ReminderForm from './components/ReminderForm';
import ReminderList from './components/ReminderList';
import { reminderService } from './services/reminderService';
import type { GoogleCalendarConnection, Reminder } from './types/reminder';

export default function App() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [calendarConnection, setCalendarConnection] =
    useState<GoogleCalendarConnection | null>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadInitialData = async () => {
    setLoadingList(true);
    setError(null);
    try {
      const [list, conn] = await Promise.all([
        reminderService.list(),
        reminderService.getGoogleCalendarConnection(),
      ]);

      setReminders(list);
      setCalendarConnection(conn);
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  const handleCreateReminder = async (text: string) => {
    setCreating(true);
    setError(null);
    try {
      const created = await reminderService.create({ text });
      setReminders((prev) => [created, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '建立提醒失敗');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteReminder = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await reminderService.remove(id);
      setReminders((prev) => prev.filter((item) => item.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '刪除提醒失敗');
    } finally {
      setDeletingId(null);
    }
  };

  const handleConnectGoogleCalendar = async () => {
    setConnecting(true);
    setError(null);
    try {
      await reminderService.connectGoogleCalendar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google 連線失敗');
      setConnecting(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncMessage(null);
    try {
      const result = await reminderService.syncGoogleCalendar();
      setSyncMessage(`同步完成：${result.synced}/${result.items.length} 筆成功`);
      const conn = await reminderService.getGoogleCalendarConnection();
      setCalendarConnection(conn);
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失敗');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="container stack">
      <header>
        <h1>自然語言行事曆提醒 MVP</h1>
        <p className="hint">前端已串接後端 API（可用環境變數設定 API Base URL）。</p>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {syncMessage ? <p className="hint">{syncMessage}</p> : null}

      <GoogleCalendarConnectButton
        connection={calendarConnection}
        loading={connecting}
        syncing={syncing}
        onConnect={handleConnectGoogleCalendar}
        onSync={handleManualSync}
      />

      <ReminderForm loading={creating} onSubmit={handleCreateReminder} />

      {loadingList ? (
        <section className="card">
          <p>載入提醒中...</p>
        </section>
      ) : (
        <ReminderList
          deletingId={deletingId}
          reminders={reminders}
          onDelete={handleDeleteReminder}
        />
      )}
    </main>
  );
}
