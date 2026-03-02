import type { GoogleCalendarConnection } from '../types/reminder';

interface GoogleCalendarConnectButtonProps {
  connection: GoogleCalendarConnection | null;
  loading?: boolean;
  syncing?: boolean;
  onConnect: () => Promise<void>;
  onSync: () => Promise<void>;
}

export default function GoogleCalendarConnectButton({
  connection,
  loading = false,
  syncing = false,
  onConnect,
  onSync,
}: GoogleCalendarConnectButtonProps) {
  const connected = connection?.connected;

  return (
    <section className="card stack">
      <h2>Google Calendar</h2>
      <p className="hint">
        {connected
          ? `已連線：${connection?.accountEmail || 'Google 帳號'}${
              connection?.expiresAt ? `（到期：${new Date(connection.expiresAt).toLocaleString()}）` : ''
            }`
          : '尚未連線'}
      </p>

      <div className="button-row">
        <button disabled={loading} onClick={onConnect} type="button">
          {connected ? '重新連線 Google Calendar' : loading ? '連線中...' : '連線 Google Calendar'}
        </button>

        <button disabled={!connected || syncing} onClick={onSync} type="button">
          {syncing ? '同步中...' : '手動同步'}
        </button>
      </div>
    </section>
  );
}
