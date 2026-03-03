# MYcalendar (Desktop MVP)

Windows laptop desktop app prototype based on Electron + React + TypeScript.

## Run (Live Preview While Developing)

```bash
npm install
npm run dev:desktop
```

- Electron app window opens on your laptop.
- When you edit files in `src/`, UI updates automatically (HMR).

## Web Preview (Optional)

```bash
npm run dev:web
```

- Open `http://localhost:5173` or `http://127.0.0.1:5173` on Windows browser.
- If you use WSL and it still does not open, fully restart terminal and rerun `npm run dev:web`.

## Main Files

- `electron/main.cjs`: Electron main process (desktop window bootstrap)
- `src/App.tsx`: current UI screen
- `src/styles.css`: styling

## If It Does Not Open

```bash
# 1) check web dev server only
npm run dev:web

# 2) then run full desktop mode again
npm run dev:desktop
```
