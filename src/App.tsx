import {
  CSSProperties,
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Priority = "high" | "medium" | "low";

type Task = {
  id: string;
  title: string;
  priority: Priority;
  estimateMin: number;
  dueDate: string;
  status: "todo" | "done";
  source: "manual" | "email" | "google";
  googleEventId?: string;
};

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

type GCalConfig = {
  clientId: string;
  clientSecret: string;
  calendarId: string;
  connected: boolean;
};

type AppUsageMap = Record<string, number>;

const DEFAULT_GCAL_CONFIG: GCalConfig = {
  clientId: "",
  clientSecret: "",
  calendarId: "primary",
  connected: false,
};

const STORAGE_KEY = "mycalendar.milestone2.tasks";
const FOCUS_STORAGE_KEY = "mycalendar.focus.daily";
const FOCUS_RUNTIME_STORAGE_KEY = "mycalendar.focus.runtime";
const APP_USAGE_STORAGE_KEY = "mycalendar.app.usage.daily";
const BG_IMAGE_STORAGE_KEY = "mycalendar.ui.bgImage";
const BG_OPACITY_STORAGE_KEY = "mycalendar.ui.bgOpacity";
const today = dateOnly(new Date());

const DEFAULT_MAIL_CONFIG: MailConfig = {
  pollSeconds: 45,
  ignoredSenders: ["noreply@newsletter.dev"],
  accounts: [
    {
      id: "gmail",
      name: "Gmail",
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      username: "",
      password: "",
      enabled: true,
    },
    {
      id: "korea-uni",
      name: "KoreaU NaverWorks",
      host: "imap.worksmobile.com",
      port: 993,
      secure: true,
      username: "",
      password: "",
      enabled: true,
    },
  ],
};

const starterTasks: Task[] = [];
const LEGACY_SAMPLE_TASK_TITLES = new Set([
  "오늘 브리핑 확인",
  "집중시간 45분 블록 시작",
  "미완료 작업 정리",
]);

function App() {
  const isOverlayMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("overlay") === "1";
  if (isOverlayMode) {
    return <OverlayWidget />;
  }

  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>("medium");
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(viewYear);
  const [pickerMonth, setPickerMonth] = useState(viewMonth);
  const [isQuickModalOpen, setIsQuickModalOpen] = useState(false);
  const [quickTaskDate, setQuickTaskDate] = useState(today);
  const [quickTaskTitle, setQuickTaskTitle] = useState("");
  const [quickTaskPriority, setQuickTaskPriority] =
    useState<Priority>("medium");
  const [focusAccumulatedSec, setFocusAccumulatedSec] = useState(() =>
    loadTodayFocusSeconds(),
  );
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(() =>
    loadFocusStartedAtMs(),
  );
  const [, setFocusTick] = useState(0);
  const [appUsageByName, setAppUsageByName] = useState<AppUsageMap>(() =>
    loadTodayAppUsage(),
  );
  const [appIconByName, setAppIconByName] = useState<Record<string, string>>({});

  const [mailConfig, setMailConfig] = useState<MailConfig>(DEFAULT_MAIL_CONFIG);
  const [isMailSettingsOpen, setIsMailSettingsOpen] = useState(false);
  const [mailIgnoredInput, setMailIgnoredInput] = useState("");
  const [mailItems, setMailItems] = useState<MailItem[]>([]);
  const [mailErrors, setMailErrors] = useState<string[]>([]);
  const [mailStatus, setMailStatus] = useState("메일 연결 필요");
  const [markingReadIds, setMarkingReadIds] = useState<Set<string>>(new Set());
  const [gcalConfig, setGcalConfig] = useState<GCalConfig>(DEFAULT_GCAL_CONFIG);
  const [gcalStatus, setGcalStatus] = useState("Not connected");
  const [isGCalSettingsOpen, setIsGCalSettingsOpen] = useState(false);
  const [isTopToolsOpen, setIsTopToolsOpen] = useState(false);
  const [isGCalBusy, setIsGCalBusy] = useState(false);
  const [overlayState, setOverlayState] = useState<{ visible: boolean }>({
    visible: false,
  });
  const suppressNextPushRef = useRef(false);
  const gcalActionLockRef = useRef(false);

  const [backgroundImage, setBackgroundImage] = useState<string>(
    () => localStorage.getItem(BG_IMAGE_STORAGE_KEY) ?? "",
  );
  const [bgOpacity, setBgOpacity] = useState<number>(() => {
    const raw = Number(localStorage.getItem(BG_OPACITY_STORAGE_KEY));
    return Number.isFinite(raw) ? Math.min(0.95, Math.max(0.35, raw)) : 0.78;
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const notifiedMailIdsRef = useRef<Set<string>>(new Set());
  const initialMailFetchRef = useRef(false);

  const calendarCells = buildCalendar(viewYear, viewMonth);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    if (!focusStartedAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setFocusTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusStartedAt]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== FOCUS_RUNTIME_STORAGE_KEY &&
        event.key !== FOCUS_STORAGE_KEY
      ) {
        return;
      }
      setFocusStartedAt(loadFocusStartedAtMs());
      setFocusAccumulatedSec(loadTodayFocusSeconds());
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const focusElapsedSec =
    focusAccumulatedSec +
    (focusStartedAt
      ? Math.max(0, Math.floor((Date.now() - focusStartedAt) / 1000))
      : 0);

  useEffect(() => {
    saveTodayFocusSeconds(focusElapsedSec);
  }, [focusElapsedSec]);

  useEffect(() => {
    saveTodayAppUsage(appUsageByName);
  }, [appUsageByName]);

  useEffect(() => {
    if (!window.usageBridge) {
      return;
    }

    const sampleIntervalSec = 10;

    const sample = async () => {
      try {
        const active = await window.usageBridge!.getActiveApp();
        const name = String(active?.app || "").trim() || "Unknown";
        setAppUsageByName((prev) => ({
          ...prev,
          [name]: (prev[name] || 0) + sampleIntervalSec,
        }));
        if (active?.iconDataUrl) {
          setAppIconByName((prev) => {
            if (prev[name] === active.iconDataUrl) return prev;
            return { ...prev, [name]: active.iconDataUrl };
          });
        }
      } catch {
        // silent: usage tracking should not break UI
      }
    };

    void sample();
    const timer = window.setInterval(sample, sampleIntervalSec * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (backgroundImage) {
      localStorage.setItem(BG_IMAGE_STORAGE_KEY, backgroundImage);
    } else {
      localStorage.removeItem(BG_IMAGE_STORAGE_KEY);
    }
  }, [backgroundImage]);

  useEffect(() => {
    localStorage.setItem(BG_OPACITY_STORAGE_KEY, String(bgOpacity));
  }, [bgOpacity]);

  useEffect(() => {
    const run = async () => {
      if (!window.mailBridge) {
        setMailStatus("메일 브리지 미연결");
        return;
      }

      try {
        const config = await window.mailBridge.getConfig();
        if (config.accounts.length > 0) {
          setMailConfig(config);
          setMailStatus("메일 설정 로드 완료");
        } else {
          await window.mailBridge.saveConfig(DEFAULT_MAIL_CONFIG);
          setMailConfig(DEFAULT_MAIL_CONFIG);
          setMailStatus("기본 메일 설정 생성 완료");
        }
      } catch (error) {
        setMailStatus(`메일 설정 로드 실패: ${(error as Error).message}`);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!window.gcalBridge) {
        setGcalStatus("GCal bridge disconnected");
        return;
      }

      try {
        const config = await window.gcalBridge.getConfig();
        setGcalConfig(config);
        setGcalStatus(
          config.connected
            ? "Google Calendar connected"
            : "Google Calendar not connected",
        );
      } catch (error) {
        setGcalStatus(`GCal config failed: ${(error as Error).message}`);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!window.overlayBridge) return;
      try {
        const state = await window.overlayBridge.getState();
        setOverlayState(state);
      } catch {
        // noop
      }
    };
    void run();
  }, []);

  useEffect(() => {
    if (!window.overlayBridge) return;

    const timer = window.setInterval(async () => {
      try {
        const state = await window.overlayBridge!.getState();
        setOverlayState((prev) =>
          prev.visible === state.visible ? prev : state,
        );
      } catch {
        // noop
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!window.mailBridge) {
      return;
    }

    const refresh = async () => {
      try {
        const result = await window.mailBridge!.fetchUnread();
        const nextItems = result.emails;
        setMailItems(nextItems);
        setMailErrors(result.errors);
        setMailStatus(
          `Last sync: ${new Date(result.polledAt).toLocaleTimeString()}`,
        );

        const ids = new Set(nextItems.map((mail) => mail.id));

        if (!initialMailFetchRef.current) {
          notifiedMailIdsRef.current = ids;
          initialMailFetchRef.current = true;
          return;
        }

        const newcomers = nextItems.filter(
          (mail) => !notifiedMailIdsRef.current.has(mail.id),
        );
        for (const mail of newcomers.slice(0, 5)) {
          await window.mailBridge!.notify({
            title: `New mail: ${mail.accountName}`,
            body: `${mail.sender}\n${mail.subject}`,
          });
        }

        notifiedMailIdsRef.current = ids;
      } catch (error) {
        setMailStatus(`메일 읽기 실패: ${(error as Error).message}`);
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, mailConfig.pollSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [mailConfig.pollSeconds]);

  useEffect(() => {
    if (!window.gcalBridge || !gcalConfig.connected) {
      return;
    }

    const pull = async () => {
      try {
        const result = await window.gcalBridge!.syncPull();
        const incoming = Array.isArray(result.tasks)
          ? (result.tasks as Task[])
          : [];
        if (incoming.length === 0) return;

        suppressNextPushRef.current = true;
        setTasks((prev) => mergeGoogleTasks(prev, incoming, true));
        setGcalStatus(`GCal pulled: ${incoming.length} items`);
      } catch (error) {
        setGcalStatus(`GCal pull failed: ${(error as Error).message}`);
      }
    };

    void pull();
    const timer = window.setInterval(pull, 60000);
    return () => window.clearInterval(timer);
  }, [gcalConfig.connected]);

  useEffect(() => {
    if (!window.gcalBridge || !gcalConfig.connected) {
      return;
    }
    if (suppressNextPushRef.current) {
      suppressNextPushRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const result = await window.gcalBridge!.syncPush({ tasks });
        if (Array.isArray(result.mappings) && result.mappings.length > 0) {
          const map = new Map(
            result.mappings.map((row) => [row.taskId, row.eventId]),
          );
          setTasks((prev) => {
            let changed = false;
            const next = prev.map((task) => {
              const eventId = map.get(task.id);
              if (!eventId || task.googleEventId === eventId) {
                return task;
              }
              changed = true;
              return { ...task, googleEventId: eventId };
            });
            return changed ? next : prev;
          });
        }
      } catch (error) {
        setGcalStatus(`GCal push failed: ${(error as Error).message}`);
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [tasks, gcalConfig.connected]);

  const selectedTasks = tasks.filter((task) => task.dueDate === selectedDate);
  const doneSelectedCount = selectedTasks.filter(
    (task) => task.status === "done",
  ).length;
  const todoSelectedCount = selectedTasks.filter(
    (task) => task.status === "todo",
  ).length;

  const top3 = useMemo(
    () =>
      selectedTasks
        .filter((task) => task.status === "todo")
        .sort((a, b) => scoreTask(b) - scoreTask(a))
        .slice(0, 3),
    [selectedTasks],
  );

  const appUsageRows = useMemo(
    () =>
      Object.entries(appUsageByName)
        .filter(([, sec]) => sec > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    [appUsageByName],
  );
  const usageMaxSec = appUsageRows.length > 0 ? Math.max(...appUsageRows.map(([, sec]) => sec)) : 1;

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) {
      return;
    }

    const task: Task = {
      id: crypto.randomUUID(),
      title,
      priority: newTaskPriority,
      estimateMin: newTaskPriority === "high" ? 40 : 25,
      dueDate: selectedDate,
      status: "todo",
      source: "manual",
    };
    setTasks((prev) => [task, ...prev]);
    setNewTaskTitle("");
    setNewTaskPriority("medium");
  }

  function toggleDone(id: string) {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id
          ? { ...task, status: task.status === "done" ? "todo" : "done" }
          : task,
      ),
    );
  }

  async function deleteTask(task: Task) {
    if (task.googleEventId && window.gcalBridge && gcalConfig.connected) {
      try {
        await window.gcalBridge.deleteEvent({ eventId: task.googleEventId });
      } catch (error) {
        setGcalStatus(`GCal delete failed: ${(error as Error).message}`);
        return;
      }
    }

    setTasks((prev) => prev.filter((row) => row.id !== task.id));
  }

  function moveIncompleteToTomorrow() {
    const nextDate = dateOnly(addDays(parseDateOnly(selectedDate), 1));
    setTasks((prev) =>
      prev.map((task) =>
        task.dueDate === selectedDate && task.status === "todo"
          ? { ...task, dueDate: nextDate }
          : task,
      ),
    );
  }

  function moveMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function moveYear(delta: number) {
    setViewYear((prev) => prev + delta);
  }

  function openMonthPicker() {
    setPickerYear(viewYear);
    setPickerMonth(viewMonth);
    setIsMonthPickerOpen(true);
  }

  function applyMonthPicker() {
    setViewYear(pickerYear);
    setViewMonth(pickerMonth);
    setIsMonthPickerOpen(false);
  }

  function openQuickAddModal(date: string) {
    setQuickTaskDate(date);
    setQuickTaskTitle("");
    setQuickTaskPriority("medium");
    setIsQuickModalOpen(true);
  }

  function closeQuickAddModal() {
    setIsQuickModalOpen(false);
    setQuickTaskTitle("");
  }

  function submitQuickAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickTaskTitle.trim();
    if (!title) {
      return;
    }

    const task: Task = {
      id: crypto.randomUUID(),
      title,
      priority: quickTaskPriority,
      estimateMin: quickTaskPriority === "high" ? 40 : 25,
      dueDate: quickTaskDate,
      status: "todo",
      source: "manual",
    };
    setTasks((prev) => [task, ...prev]);
    setSelectedDate(quickTaskDate);
    closeQuickAddModal();
  }

  function startFocusTimer() {
    if (focusStartedAt) {
      return;
    }
    const now = Date.now();
    setFocusStartedAt(now);
    saveFocusRuntime({ startedAtMs: now });
  }

  function pauseFocusTimer() {
    if (!focusStartedAt) {
      return;
    }
    const lapSec = Math.max(
      0,
      Math.floor((Date.now() - focusStartedAt) / 1000),
    );
    setFocusAccumulatedSec((prev) => prev + lapSec);
    setFocusStartedAt(null);
    saveFocusRuntime({ startedAtMs: null });
  }

  function resetFocusTimer() {
    setFocusAccumulatedSec(0);
    setFocusStartedAt(null);
    setFocusTick(0);
    saveTodayFocusSeconds(0);
    saveFocusRuntime({ startedAtMs: null });
  }

  function handleBackgroundFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setBackgroundImage(result);
    };
    reader.readAsDataURL(file);
  }

  function updateMailAccount(
    accountId: string,
    patch: Partial<MailAccountConfig>,
  ) {
    setMailConfig((prev) => ({
      ...prev,
      accounts: prev.accounts.map((acc) =>
        acc.id === accountId ? { ...acc, ...patch } : acc,
      ),
    }));
  }

  function addIgnoredSender() {
    const value = mailIgnoredInput.trim().toLowerCase();
    if (!value) return;

    setMailConfig((prev) => {
      if (prev.ignoredSenders.includes(value)) return prev;
      return {
        ...prev,
        ignoredSenders: [...prev.ignoredSenders, value],
      };
    });
    setMailIgnoredInput("");
  }

  function removeIgnoredSender(value: string) {
    setMailConfig((prev) => ({
      ...prev,
      ignoredSenders: prev.ignoredSenders.filter((item) => item !== value),
    }));
  }

  async function saveMailSettings() {
    if (!window.mailBridge) {
      setMailStatus("메일 브리지 미연결");
      return;
    }
    try {
      const saved = await window.mailBridge.saveConfig(mailConfig);
      setMailConfig(saved);
      setMailStatus("메일 설정 저장 완료");
      setIsMailSettingsOpen(false);
    } catch (error) {
      setMailStatus(`메일 설정 저장 실패: ${(error as Error).message}`);
    }
  }

  async function markMailAsRead(mail: MailItem) {
    if (!window.mailBridge) {
      setMailStatus("메일 브리지 미연결");
      return;
    }

    setMarkingReadIds((prev) => new Set(prev).add(mail.id));
    try {
      await window.mailBridge.markRead({
        accountId: mail.accountId,
        uid: mail.uid,
      });
      setMailItems((prev) => prev.filter((item) => item.id !== mail.id));
      setMailStatus(`Marked read: ${mail.subject}`);
    } catch (error) {
      setMailStatus(`읽음 처리 실패: ${(error as Error).message}`);
    } finally {
      setMarkingReadIds((prev) => {
        const next = new Set(prev);
        next.delete(mail.id);
        return next;
      });
    }
  }

  async function runWithGCalLock(action: () => Promise<void>) {
    if (gcalActionLockRef.current) {
      return;
    }
    gcalActionLockRef.current = true;
    setIsGCalBusy(true);
    try {
      await action();
    } finally {
      setIsGCalBusy(false);
      gcalActionLockRef.current = false;
    }
  }

  async function saveGCalConfigOnly(): Promise<GCalConfig | null> {
    if (!window.gcalBridge) {
      setGcalStatus("GCal bridge disconnected");
      return null;
    }

    const saved = await window.gcalBridge.saveConfig({
      clientId: gcalConfig.clientId,
      clientSecret: gcalConfig.clientSecret,
      calendarId: gcalConfig.calendarId || "primary",
    });
    setGcalConfig(saved);
    return saved;
  }

  async function saveGCalSettings() {
    await runWithGCalLock(async () => {
      try {
        await saveGCalConfigOnly();
        setGcalStatus("GCal config saved");
      } catch (error) {
        setGcalStatus(`GCal save failed: ${(error as Error).message}`);
      }
    });
  }

  async function connectGCal() {
    await runWithGCalLock(async () => {
      if (!window.gcalBridge) {
        setGcalStatus("GCal bridge disconnected");
        return;
      }

      try {
        const saved = await saveGCalConfigOnly();
        if (!saved) return;
        const connected = await window.gcalBridge.connect();
        setGcalConfig(connected);
        setGcalStatus("Google Calendar connected");
      } catch (error) {
        setGcalStatus(`GCal connect failed: ${(error as Error).message}`);
      }
    });
  }

  async function disconnectGCal() {
    await runWithGCalLock(async () => {
      if (!window.gcalBridge) return;
      try {
        const disconnected = await window.gcalBridge.disconnect();
        setGcalConfig(disconnected);
        setGcalStatus("Google Calendar disconnected");
      } catch (error) {
        setGcalStatus(`GCal disconnect failed: ${(error as Error).message}`);
      }
    });
  }

  async function syncGCalNow() {
    await runWithGCalLock(async () => {
      if (!window.gcalBridge || !gcalConfig.connected) {
        setGcalStatus("Connect Google Calendar first");
        return;
      }

      try {
        await window.gcalBridge.syncPush({ tasks });
        const pulled = await window.gcalBridge.syncPull();
        const incoming = Array.isArray(pulled.tasks)
          ? (pulled.tasks as Task[])
          : [];
        suppressNextPushRef.current = true;
        setTasks((prev) => mergeGoogleTasks(prev, incoming, true));
        setGcalStatus(`Synced now (${incoming.length})`);
      } catch (error) {
        setGcalStatus(`GCal sync failed: ${(error as Error).message}`);
      }
    });
  }

  async function toggleOverlayWindow() {
    if (!window.overlayBridge) return;
    try {
      const next = await window.overlayBridge.toggle();
      setOverlayState(next);
    } catch {
      // noop
    }
  }

  return (
    <main
      className={`app ${backgroundImage ? "has-user-bg" : ""}`}
      style={
        {
          "--user-bg-opacity": Math.min(0.92, Math.max(0.2, bgOpacity * 0.9)),
          "--ui-alpha": bgOpacity,
        } as CSSProperties
      }
    >
      {backgroundImage ? (
        <>
          <div
            className="user-bg-image"
            style={{ backgroundImage: `url("${backgroundImage}")` }}
            aria-hidden="true"
          />
          <div className="user-bg-dim" aria-hidden="true" />
        </>
      ) : null}
      <header className="top">
        <p className="eyebrow">DESKTOP PRODUCTIVITY HUB</p>
        <div className="top-title-row">
          <h1>MYcalendar</h1>
          <div className="top-tools-toggle">
            <button
              className="action ghost top-quiet top-icon-toggle"
              type="button"
              onClick={() => setIsTopToolsOpen((prev) => !prev)}
              aria-expanded={isTopToolsOpen}
              aria-label={isTopToolsOpen ? "Hide tools" : "Show tools"}
              title={isTopToolsOpen ? "Hide tools" : "Show tools"}
            >
              ⚙
            </button>
          </div>
        </div>
        <div className={`top-actions ${isTopToolsOpen ? "open" : "closed"}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleBackgroundFile}
            hidden
          />
          <button
            className="action secondary top-quiet"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Set BG
          </button>
          <button
            className="action ghost top-quiet"
            type="button"
            onClick={() => setBackgroundImage("")}
          >
            Clear BG
          </button>
          <label className="opacity-control">
            UI Opacity
            <input
              type="range"
              min={35}
              max={95}
              value={Math.round(bgOpacity * 100)}
              onChange={(event) =>
                setBgOpacity(Number(event.target.value) / 100)
              }
            />
          </label>
          <button
            className="action secondary top-quiet"
            type="button"
            onClick={() => setIsGCalSettingsOpen((prev) => !prev)}
          >
            {isGCalSettingsOpen ? "Close Sync" : "GCal Sync"}
          </button>
          <button
            className="action primary top-quiet"
            type="button"
            disabled={isGCalBusy}
            onClick={() => void syncGCalNow()}
          >
            Sync Now
          </button>
          <button
            className="action secondary top-quiet"
            type="button"
            onClick={() => void toggleOverlayWindow()}
          >
            {overlayState.visible ? "Hide Overlay" : "Show Overlay"}
          </button>
        </div>
        <p className="label">{gcalStatus}</p>

        {isGCalSettingsOpen ? (
          <div className="mail-settings">
            <p className="label">Google Calendar Settings</p>
            <div className="add-form">
              <input
                value={gcalConfig.clientId}
                onChange={(event) =>
                  setGcalConfig((prev) => ({
                    ...prev,
                    clientId: event.target.value,
                  }))
                }
                placeholder="Google OAuth Client ID"
              />
              <input
                type="password"
                value={gcalConfig.clientSecret}
                onChange={(event) =>
                  setGcalConfig((prev) => ({
                    ...prev,
                    clientSecret: event.target.value,
                  }))
                }
                placeholder="Google OAuth Client Secret"
              />
            </div>
            <div className="add-form">
              <input
                value={gcalConfig.calendarId}
                onChange={(event) =>
                  setGcalConfig((prev) => ({
                    ...prev,
                    calendarId: event.target.value,
                  }))
                }
                placeholder="Calendar ID (default: primary)"
              />
            </div>
            <div className="modal-actions">
              <button
                className="action secondary"
                type="button"
                disabled={isGCalBusy}
                onClick={() => void saveGCalSettings()}
              >
                Save Sync
              </button>
              {gcalConfig.connected ? (
                <button
                  className="action ghost"
                  type="button"
                  disabled={isGCalBusy}
                  onClick={() => void disconnectGCal()}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="action primary"
                  type="button"
                  disabled={isGCalBusy}
                  onClick={() => void connectGCal()}
                >
                  Connect
                </button>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <section className="layout">
        <article className="card calendar-card">
          <div className="row calendar-toolbar">
            <h2>Calendar</h2>
            <div className="toolbar-actions">
              <button className="action ghost" onClick={() => moveYear(-1)}>
                -
              </button>
              <button className="action ghost" onClick={() => moveMonth(-1)}>
                ←
              </button>
              <button
                className="month-label month-label-button"
                onClick={openMonthPicker}
                type="button"
              >
                {viewYear}-{String(viewMonth + 1).padStart(2, "0")}
              </button>
              <button className="action ghost" onClick={() => moveMonth(1)}>
                →
              </button>
              <button className="action ghost" onClick={() => moveYear(1)}>
                +
              </button>
            </div>
          </div>
          <div className="week-row">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="date-grid">
            {calendarCells.map((cell, idx) => (
              <button
                key={`${cell.date ?? "empty"}-${idx}`}
                className={`date-cell ${cell.inMonth ? "" : "empty-cell"} ${cell.date === today ? "today-cell" : ""} ${cell.date === selectedDate ? "selected-cell" : ""}`}
                onClick={() => {
                  if (cell.date) {
                    setSelectedDate(cell.date);
                  }
                }}
                onDoubleClick={() => {
                  if (cell.date) {
                    openQuickAddModal(cell.date);
                  }
                }}
                title={cell.date ? `${cell.date} (double-click to add)` : ""}
                disabled={!cell.date}
                type="button"
              >
                {cell.date ? Number(cell.date.slice(8)) : ""}
              </button>
            ))}
          </div>
          <div className="stats">
            <p>Date: {selectedDate}</p>
            <div className="stats-grid">
              <div className="stat-cell">
                <span className="stat-label">Todo</span>
                <strong>{todoSelectedCount}</strong>
              </div>
              <div className="stat-cell">
                <span className="stat-label">Done</span>
                <strong>{doneSelectedCount}</strong>
              </div>
            </div>
          </div>
          <div className="focus-timer">
            <p className="label">Focus Timer</p>
            <p className="timer-readout">{formatDuration(focusElapsedSec)}</p>
            <div className="timer-controls">
              {focusStartedAt ? (
                <button
                  className="action primary icon-btn"
                  type="button"
                  onClick={pauseFocusTimer}
                  aria-label="Pause timer"
                  title="Pause"
                >
                  &#10074;&#10074;
                </button>
              ) : (
                <button
                  className="action primary icon-btn"
                  type="button"
                  onClick={startFocusTimer}
                  aria-label="Start timer"
                  title="Start"
                >
                  &#9654;
                </button>
              )}
              <button
                className="action ghost icon-btn"
                type="button"
                onClick={resetFocusTimer}
                aria-label="Reset timer"
                title="Reset"
              >
                &#8635;
              </button>
            </div>

            <div className="usage-panel">
              <p className="label">Today App Usage</p>
              <ul className="usage-list">
                {appUsageRows.length === 0 ? <li>No app activity yet</li> : null}
                {appUsageRows.map(([appName, seconds]) => (
                  <li key={appName}>
                    <div className="usage-row-head">
                      <span className="usage-app-left">
                        {appIconByName[appName] ? (
                          <img
                            className="usage-logo-img"
                            src={appIconByName[appName]}
                            alt=""
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="usage-logo" aria-hidden="true">
                            {getAppLogo(appName)}
                          </span>
                        )}
                        <span className="usage-app-name">{appName}</span>
                      </span>
                      <strong>{formatUsageMinutes(seconds)}</strong>
                    </div>
                    <div className="usage-bar">
                      <span
                        className="usage-bar-fill"
                        style={{
                          width: `${Math.max(
                            8,
                            Math.round((seconds / usageMaxSec) * 100),
                          )}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>

        <article className="card mail-card">
          <div className="row">
            <h2>Mail</h2>
            <div className="row">
              <button
                className="action secondary"
                onClick={() => setIsMailSettingsOpen((prev) => !prev)}
              >
                {isMailSettingsOpen ? "Close" : "Settings"}
              </button>
            </div>
          </div>

          <p className="label">Status: {mailStatus}</p>
          {mailErrors.length > 0 ? (
            <ul className="task-list">
              {mailErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}

          {isMailSettingsOpen ? (
            <div className="mail-settings">
              <p className="label">Ignored Senders</p>
              <div className="add-form">
                <input
                  value={mailIgnoredInput}
                  onChange={(event) => setMailIgnoredInput(event.target.value)}
                  placeholder="example@domain.com"
                />
                <button
                  className="action secondary"
                  type="button"
                  onClick={addIgnoredSender}
                >
                  Add Ignore
                </button>
              </div>
              <ul className="task-list">
                {mailConfig.ignoredSenders.map((sender) => (
                  <li key={sender}>
                    {sender}{" "}
                    <button
                      className="action ghost"
                      type="button"
                      onClick={() => removeIgnoredSender(sender)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <p className="label">Accounts</p>
              {mailConfig.accounts.map((account) => (
                <div className="mail-account" key={account.id}>
                  <div className="row">
                    <strong>{account.name}</strong>
                    <label>
                      <input
                        type="checkbox"
                        checked={account.enabled}
                        onChange={(event) =>
                          updateMailAccount(account.id, {
                            enabled: event.target.checked,
                          })
                        }
                      />{" "}
                      Enabled
                    </label>
                  </div>
                  <div className="add-form">
                    <input
                      value={account.host}
                      onChange={(event) =>
                        updateMailAccount(account.id, {
                          host: event.target.value,
                        })
                      }
                      placeholder="IMAP host"
                    />
                    <input
                      value={String(account.port)}
                      onChange={(event) =>
                        updateMailAccount(account.id, {
                          port: Number(event.target.value) || 993,
                        })
                      }
                      placeholder="Port"
                    />
                  </div>
                  <div className="add-form">
                    <input
                      value={account.username}
                      onChange={(event) =>
                        updateMailAccount(account.id, {
                          username: event.target.value,
                        })
                      }
                      placeholder="Email"
                    />
                    <input
                      type="password"
                      value={account.password}
                      onChange={(event) =>
                        updateMailAccount(account.id, {
                          password: event.target.value,
                        })
                      }
                      placeholder="App password"
                    />
                  </div>
                </div>
              ))}

              <p className="label">Poll Interval (sec)</p>
              <input
                type="number"
                value={mailConfig.pollSeconds}
                min={15}
                max={300}
                onChange={(event) =>
                  setMailConfig((prev) => ({
                    ...prev,
                    pollSeconds: Math.min(
                      300,
                      Math.max(15, Number(event.target.value) || 45),
                    ),
                  }))
                }
              />
              <div className="modal-actions">
                <button
                  className="action primary"
                  type="button"
                  onClick={saveMailSettings}
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}

          <p className="label">Unread ({mailItems.length})</p>
          <ul className="task-list">
            {mailItems.length === 0 ? <li>No unread mails</li> : null}
            {mailItems.slice(0, 12).map((mail) => (
              <li key={mail.id}>
                <div className="mail-row">
                  <span>
                    [{mail.accountName}] {mail.sender} - {mail.subject}
                  </span>
                  <input
                    className="mail-check"
                    type="checkbox"
                    title="Mark as read"
                    aria-label={`Mark as read: ${mail.subject}`}
                    disabled={markingReadIds.has(mail.id)}
                    onChange={() => {
                      void markMailAsRead(mail);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="card todo-card">
          <div className="row">
            <h2>Tasks</h2>
            <button
              className="action secondary"
              onClick={moveIncompleteToTomorrow}
            >
              Task +day
            </button>
          </div>
          <p className="label">Top 3</p>
          <ul className="task-list">
            {top3.length === 0 ? <li>No pending tasks</li> : null}
            {top3.map((task) => (
              <li key={task.id}>
                <span className={`priority ${task.priority}`}>
                  {task.priority}
                </span>{" "}
                {task.title}
              </li>
            ))}
          </ul>

          <p className="label">Selected Date Tasks</p>
          <form className="add-form" onSubmit={addTask}>
            <input
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              placeholder="Task title"
            />
            <select
              value={newTaskPriority}
              onChange={(event) =>
                setNewTaskPriority(event.target.value as Priority)
              }
            >
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <button className="action primary" type="submit">
              Add
            </button>
          </form>

          <ul className="task-list">
            {selectedTasks.map((task) => (
              <li
                key={task.id}
                className={task.status === "done" ? "done" : ""}
              >
                <div className="task-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={task.status === "done"}
                      onChange={() => toggleDone(task.id)}
                    />
                    <span>
                      {task.title} ({task.estimateMin}m, {task.source})
                    </span>
                  </label>
                  <button
                    className="action ghost task-delete"
                    type="button"
                    onClick={() => {
                      void deleteTask(task);
                    }}
                  >
                    Del
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {isQuickModalOpen ? (
        <div className="modal-backdrop" onClick={closeQuickAddModal}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeQuickAddModal();
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label="quick add task"
          >
            <h3>Quick Add</h3>
            <p className="label">{quickTaskDate}</p>
            <form className="modal-form" onSubmit={submitQuickAddTask}>
              <input
                autoFocus
                value={quickTaskTitle}
                onChange={(event) => setQuickTaskTitle(event.target.value)}
                placeholder="Task title"
              />
              <select
                value={quickTaskPriority}
                onChange={(event) =>
                  setQuickTaskPriority(event.target.value as Priority)
                }
              >
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
              <div className="modal-actions">
                <button
                  type="button"
                  className="action ghost"
                  onClick={closeQuickAddModal}
                >
                  Cancel
                </button>
                <button type="submit" className="action primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isMonthPickerOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => setIsMonthPickerOpen(false)}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="year month picker"
          >
            <h3>Pick Year / Month</h3>
            <form
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                applyMonthPicker();
              }}
            >
              <select
                value={pickerYear}
                onChange={(event) => setPickerYear(Number(event.target.value))}
              >
                {Array.from({ length: 11 }, (_, idx) => viewYear - 5 + idx).map(
                  (year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ),
                )}
              </select>
              <select
                value={pickerMonth}
                onChange={(event) => setPickerMonth(Number(event.target.value))}
              >
                {Array.from({ length: 12 }, (_, idx) => idx).map((month) => (
                  <option key={month} value={month}>
                    {month + 1}
                  </option>
                ))}
              </select>
              <div className="modal-actions">
                <button
                  type="button"
                  className="action ghost"
                  onClick={() => {
                    setViewYear(new Date().getFullYear());
                    setViewMonth(new Date().getMonth());
                    setIsMonthPickerOpen(false);
                  }}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="action ghost"
                  onClick={() => setIsMonthPickerOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="action primary">
                  Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function OverlayWidget() {
  const [focusAccumulatedSec, setFocusAccumulatedSec] = useState<number>(() =>
    loadTodayFocusSeconds(),
  );
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(() =>
    loadFocusStartedAtMs(),
  );
  const [, setTick] = useState(0);
  const resizeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
  });

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "\u200B";
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    return () => {
      document.title = prevTitle;
      document.documentElement.classList.remove("overlay-mode");
      document.body.classList.remove("overlay-mode");
    };
  }, []);

  useEffect(() => {
    const sync = () => {
      setFocusAccumulatedSec(loadTodayFocusSeconds());
      setFocusStartedAt(loadFocusStartedAtMs());
    };
    sync();
    const poll = window.setInterval(sync, 3000);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!focusStartedAt) return;
    const timer = window.setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusStartedAt]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== FOCUS_RUNTIME_STORAGE_KEY &&
        event.key !== FOCUS_STORAGE_KEY
      ) {
        return;
      }
      setFocusStartedAt(loadFocusStartedAtMs());
      setFocusAccumulatedSec(loadTodayFocusSeconds());
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = resizeRef.current;
      if (!state.active || !window.overlayBridge) {
        return;
      }
      const nextW = Math.max(160, state.startW + (event.clientX - state.startX));
      const nextH = Math.max(110, state.startH + (event.clientY - state.startY));
      void window.overlayBridge.resize({ width: nextW, height: nextH });
    };

    const onMouseUp = () => {
      resizeRef.current.active = false;
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const todayDate = dateOnly(new Date());
  const focusElapsedSec =
    focusAccumulatedSec +
    (focusStartedAt
      ? Math.max(0, Math.floor((Date.now() - focusStartedAt) / 1000))
      : 0);

  function startOverlayFocusTimer() {
    if (focusStartedAt) {
      return;
    }
    const now = Date.now();
    setFocusStartedAt(now);
    saveFocusRuntime({ startedAtMs: now });
  }

  function pauseOverlayFocusTimer() {
    if (!focusStartedAt) {
      return;
    }
    const lapSec = Math.max(0, Math.floor((Date.now() - focusStartedAt) / 1000));
    const next = focusAccumulatedSec + lapSec;
    setFocusAccumulatedSec(next);
    setFocusStartedAt(null);
    saveTodayFocusSeconds(next);
    saveFocusRuntime({ startedAtMs: null });
  }

  function resetOverlayFocusTimer() {
    setFocusAccumulatedSec(0);
    setFocusStartedAt(null);
    saveTodayFocusSeconds(0);
    saveFocusRuntime({ startedAtMs: null });
  }

  async function hideOverlayFromWidget() {
    if (!window.overlayBridge) return;
    try {
      await window.overlayBridge.hide();
    } catch {
      // noop
    }
  }

  return (
    <main className="overlay-root">
      <section className="overlay-panel">
        <div className="overlay-head">
          <strong>Today</strong>
          <div className="overlay-head-right">
            <span>{todayDate}</span>
            <button
              type="button"
              className="overlay-close-btn"
              aria-label="Hide overlay"
              title="Hide overlay"
              onClick={() => void hideOverlayFromWidget()}
            >
              ×
            </button>
          </div>
        </div>
        <p className="overlay-time">{formatDuration(focusElapsedSec)}</p>
        <p className="overlay-sub">
          Focus {focusStartedAt ? "running" : "paused"}
        </p>
        <div className="overlay-timer-controls">
          {focusStartedAt ? (
            <button
              type="button"
              className="overlay-timer-btn"
              onClick={pauseOverlayFocusTimer}
              title="Pause"
              aria-label="Pause"
            >
              ⏸
            </button>
          ) : (
            <button
              type="button"
              className="overlay-timer-btn"
              onClick={startOverlayFocusTimer}
              title="Start"
              aria-label="Start"
            >
              ▶
            </button>
          )}
          <button
            type="button"
            className="overlay-timer-btn"
            onClick={resetOverlayFocusTimer}
            title="Reset"
            aria-label="Reset"
          >
            ↺
          </button>
        </div>
        <div
          className="overlay-resize-handle"
          aria-label="Resize overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            resizeRef.current = {
              active: true,
              startX: event.clientX,
              startY: event.clientY,
              startW: window.innerWidth,
              startH: window.innerHeight,
            };
            document.body.style.cursor = "nwse-resize";
            event.preventDefault();
          }}
        />
      </section>
    </main>
  );
}

function dateOnly(input: Date): string {
  const y = input.getFullYear();
  const m = String(input.getMonth() + 1).padStart(2, "0");
  const d = String(input.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(input: Date, days: number): Date {
  const next = new Date(input);
  next.setDate(next.getDate() + days);
  return next;
}

function scoreTask(task: Task): number {
  const priorityWeight =
    task.priority === "high" ? 3 : task.priority === "medium" ? 2 : 1;
  const sourceWeight = task.source === "email" ? 0.5 : 0;
  const effortPenalty = task.estimateMin > 40 ? -0.3 : 0;
  return priorityWeight + sourceWeight + effortPenalty;
}

function loadTasks(): Task[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return starterTasks;
  }

  try {
    const parsed = JSON.parse(raw) as Task[];
    if (!Array.isArray(parsed)) {
      return starterTasks;
    }
    return parsed.filter(
      (task) => !LEGACY_SAMPLE_TASK_TITLES.has(String(task?.title || "")),
    );
  } catch {
    return starterTasks;
  }
}

function mergeGoogleTasks(
  currentTasks: Task[],
  pulledTasks: Task[],
  pruneMissingGoogle: boolean,
): Task[] {
  const byGoogleId = new Map<string, Task>();
  const byTaskId = new Map<string, Task>();

  for (const task of currentTasks) {
    byTaskId.set(task.id, task);
    if (task.googleEventId) {
      byGoogleId.set(task.googleEventId, task);
    }
  }

  let next = [...currentTasks];
  const pulledGoogleIds = new Set(
    pulledTasks
      .map((task) => String(task.googleEventId || "").trim())
      .filter(Boolean),
  );

  for (const incoming of pulledTasks) {
    if (!incoming || typeof incoming !== "object") continue;
    const eventId = String(incoming.googleEventId || "").trim();
    const mappedByEvent = eventId ? byGoogleId.get(eventId) : undefined;
    const mappedById = byTaskId.get(incoming.id);
    const target = mappedByEvent || mappedById;

    if (target) {
      const idx = next.findIndex((row) => row.id === target.id);
      if (idx >= 0) {
        next[idx] = {
          ...target,
          title: String(incoming.title || target.title),
          dueDate: String(incoming.dueDate || target.dueDate),
          googleEventId: eventId || target.googleEventId,
          source: target.source === "google" ? "google" : target.source,
        };
      }
    } else {
      next.unshift({
        id: String(
          incoming.id || `gcal-${Math.random().toString(36).slice(2)}`,
        ),
        title: String(incoming.title || "Untitled"),
        priority: (incoming.priority as Priority) || "medium",
        estimateMin: Number(incoming.estimateMin) || 25,
        dueDate: String(incoming.dueDate || today),
        status: incoming.status === "done" ? "done" : "todo",
        source: "google",
        googleEventId: eventId || undefined,
      });
    }
  }

  if (pruneMissingGoogle) {
    next = next.filter((task) => {
      const eventId = String(task.googleEventId || "").trim();
      if (!eventId) return true;
      if (!isWithinGoogleSyncWindow(task.dueDate)) return true;
      return pulledGoogleIds.has(eventId);
    });
  }

  return next;
}

function isWithinGoogleSyncWindow(dueDate: string): boolean {
  const d = parseDateOnly(dueDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const min = new Date(now);
  min.setDate(min.getDate() - 30);
  const max = new Date(now);
  max.setDate(max.getDate() + 365);
  return d >= min && d <= max;
}

type CalendarCell = {
  date: string | null;
  inMonth: boolean;
};

function buildCalendar(year: number, monthIndex: number): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  const startWeekday = first.getDay();

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push({
      date: null,
      inMonth: false,
    });
  }

  for (let day = 1; day <= lastDay; day += 1) {
    cells.push({
      date: dateOnly(new Date(year, monthIndex, day)),
      inMonth: true,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      date: null,
      inMonth: false,
    });
  }

  return cells;
}

function loadTodayFocusSeconds(): number {
  const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
  if (!raw) {
    return 0;
  }

  try {
    const parsed = JSON.parse(raw) as { date?: string; seconds?: number };
    if (parsed.date !== dateOnly(new Date())) {
      return 0;
    }
    return Number.isFinite(parsed.seconds)
      ? Math.max(0, Math.floor(parsed.seconds as number))
      : 0;
  } catch {
    return 0;
  }
}

function saveTodayFocusSeconds(seconds: number): void {
  localStorage.setItem(
    FOCUS_STORAGE_KEY,
    JSON.stringify({
      date: dateOnly(new Date()),
      seconds: Math.max(0, Math.floor(seconds)),
    }),
  );
}

function loadFocusStartedAtMs(): number | null {
  const raw = localStorage.getItem(FOCUS_RUNTIME_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      date?: string;
      startedAtMs?: number | null;
    };
    if (parsed.date !== dateOnly(new Date())) {
      return null;
    }
    const startedAtMs = Number(parsed.startedAtMs);
    return Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : null;
  } catch {
    return null;
  }
}

function saveFocusRuntime(payload: { startedAtMs: number | null }): void {
  localStorage.setItem(
    FOCUS_RUNTIME_STORAGE_KEY,
    JSON.stringify({
      date: dateOnly(new Date()),
      startedAtMs: payload.startedAtMs,
    }),
  );
}

function loadTodayAppUsage(): AppUsageMap {
  const raw = localStorage.getItem(APP_USAGE_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as { date?: string; usage?: AppUsageMap };
    if (parsed.date !== dateOnly(new Date())) {
      return {};
    }
    if (!parsed.usage || typeof parsed.usage !== "object") {
      return {};
    }

    const out: AppUsageMap = {};
    for (const [name, sec] of Object.entries(parsed.usage)) {
      const n = Number(sec);
      if (!Number.isFinite(n) || n <= 0) continue;
      out[String(name)] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

function saveTodayAppUsage(usage: AppUsageMap): void {
  localStorage.setItem(
    APP_USAGE_STORAGE_KEY,
    JSON.stringify({
      date: dateOnly(new Date()),
      usage,
    }),
  );
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatUsageMinutes(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.max(1, Math.floor(sec / 60));
  return `${minutes}m`;
}

function getAppLogo(appName: string): string {
  const n = appName.toLowerCase();
  if (n.includes("chrome")) return "🌐";
  if (n.includes("edge")) return "🌀";
  if (n.includes("code") || n.includes("vscode")) return "🧩";
  if (n.includes("excel")) return "📗";
  if (n.includes("word")) return "📘";
  if (n.includes("powerpoint") || n.includes("ppt")) return "📙";
  if (n.includes("notion")) return "📝";
  if (n.includes("figma")) return "🎨";
  if (n.includes("slack")) return "💬";
  if (n.includes("discord")) return "🎧";
  if (n.includes("spotify")) return "🎵";
  if (n.includes("zoom")) return "📹";
  if (n.includes("teams")) return "👥";
  if (n.includes("powershell") || n.includes("terminal") || n.includes("cmd")) return "⌨️";
  if (n.includes("explorer")) return "📁";
  return "⬢";
}

export default App;
