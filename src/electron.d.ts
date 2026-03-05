export {};

type MailAccountConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  enabled: boolean;
};

type MailConfig = {
  pollSeconds: number;
  ignoredSenders: string[];
  accounts: MailAccountConfig[];
};

type MailItem = {
  id: string;
  uid: number;
  accountId: string;
  accountName: string;
  sender: string;
  senderAddress: string;
  subject: string;
  date: string;
};

type MailFetchResult = {
  emails: MailItem[];
  errors: string[];
  polledAt: string;
};

declare global {
  interface Window {
    mailBridge?: {
      getConfig: () => Promise<MailConfig>;
      saveConfig: (config: MailConfig) => Promise<MailConfig>;
      fetchUnread: () => Promise<MailFetchResult>;
      markRead: (payload: { accountId: string; uid: number }) => Promise<boolean>;
      notify: (payload: { title: string; body: string }) => Promise<boolean>;
    };
    gcalBridge?: {
      getConfig: () => Promise<{ clientId: string; clientSecret: string; calendarId: string; connected: boolean }>;
      saveConfig: (config: { clientId: string; clientSecret: string; calendarId: string }) => Promise<{
        clientId: string;
        clientSecret: string;
        calendarId: string;
        connected: boolean;
      }>;
      connect: () => Promise<{ clientId: string; clientSecret: string; calendarId: string; connected: boolean }>;
      disconnect: () => Promise<{ clientId: string; clientSecret: string; calendarId: string; connected: boolean }>;
      syncPush: (payload: { tasks: unknown[] }) => Promise<{ ok: boolean; mappings: Array<{ taskId: string; eventId: string }> }>;
      syncPull: () => Promise<{ ok: boolean; tasks: unknown[] }>;
      deleteEvent: (payload: { eventId: string }) => Promise<{ ok: boolean }>;
    };
    overlayBridge?: {
      show: () => Promise<{ visible: boolean }>;
      hide: () => Promise<{ visible: boolean }>;
      toggle: () => Promise<{ visible: boolean }>;
      resize: (payload: { width: number; height: number }) => Promise<{ ok: boolean; width: number; height: number }>;
      getState: () => Promise<{ visible: boolean }>;
    };
  }
}
