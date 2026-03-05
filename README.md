# MYcalendar

Desktop productivity app (Electron + React + TypeScript).
데스크톱 생산성 앱 (Electron + React + TypeScript)입니다.

## 1. Run / 실행

```bash
npm install
npm run dev:desktop
```

- EN: Starts Vite + Electron desktop app.
- KO: Vite + Electron 데스크톱 앱을 실행합니다.

Optional web-only preview / 웹만 미리보기:

```bash
npm run dev:web
```

## 2. Main Features / 주요 기능

- EN: Calendar with month/year navigation and date selection
- KO: 월/연도 이동이 가능한 캘린더와 날짜 선택

- EN: Task management (add/check/delete, move incomplete tasks to next day)
- KO: 할일 관리 (추가/체크/삭제, 미완료 다음날 이동)

- EN: Focus timer with start/pause/reset
- KO: 집중 타이머 (시작/일시정지/리셋)

- EN: Mail unread fetch via IMAP, mark-as-read, ignored sender list
- KO: IMAP 기반 안읽은 메일 조회, 읽음 처리, 제외 발신자 목록

- EN: Google Calendar sync (connect, push/pull, delete sync)
- KO: 구글 캘린더 동기화 (연결, push/pull, 삭제 동기화)

- EN: Overlay widget (always-on-top mini timer panel)
- KO: 오버레이 위젯 (항상 위 타이머 미니 패널)

- EN: Background image + UI opacity control
- KO: 배경 이미지 설정 + UI 투명도 조절

## 3. UI Buttons / 버튼 설명

### Top Tools (⚙) / 상단 도구 (⚙)

- `Set BG`
  - EN: Select a local image as app background
  - KO: 로컬 이미지를 앱 배경으로 설정

- `Clear BG`
  - EN: Remove custom background image
  - KO: 사용자 배경 이미지를 제거

- `UI Opacity`
  - EN: Adjust panel transparency
  - KO: 패널 투명도 조절

- `GCal Sync` / `Close Sync`
  - EN: Open/close Google Calendar settings panel
  - KO: 구글 캘린더 설정 패널 열기/닫기

- `Sync Now`
  - EN: Trigger immediate Google Calendar push/pull sync
  - KO: 구글 캘린더 즉시 동기화 실행

- `Show Overlay` / `Hide Overlay`
  - EN: Show/hide mini overlay widget
  - KO: 오버레이 위젯 표시/숨김

### Calendar Panel / 캘린더 패널

- `-` / `+`
  - EN: Move year backward/forward
  - KO: 연도 이전/다음 이동

- `←` / `→`
  - EN: Move month backward/forward
  - KO: 월 이전/다음 이동

- `YYYY-MM`
  - EN: Open year/month picker modal
  - KO: 연/월 선택 모달 열기

- Date cell click / 날짜 클릭
  - EN: Select date
  - KO: 날짜 선택

- Date cell double click / 날짜 더블클릭
  - EN: Open quick-add task modal for that date
  - KO: 해당 날짜 빠른 할일 추가 모달 열기

### Mail Panel / 메일 패널

- `Settings`
  - EN: Open mail settings (accounts, ignored senders, poll interval)
  - KO: 메일 설정 열기 (계정, 제외 발신자, 폴링 주기)

- `Save`
  - EN: Save mail settings
  - KO: 메일 설정 저장

- Read checkbox (per mail)
  - EN: Mark unread mail as read
  - KO: 안읽은 메일 읽음 처리

### Tasks Panel / 할일 패널

- `Task +day`
  - EN: Move incomplete tasks of selected date to next day
  - KO: 선택 날짜의 미완료 할일을 다음날로 이동

- `Add`
  - EN: Add a task to selected date
  - KO: 선택 날짜에 할일 추가

- Task checkbox
  - EN: Toggle todo/done
  - KO: 할일 완료/미완료 전환

- `Del`
  - EN: Delete task (also deletes linked Google event if synced)
  - KO: 할일 삭제 (동기화된 구글 이벤트도 함께 삭제)

### Overlay Widget / 오버레이 위젯

- `▶`
  - EN: Start timer
  - KO: 타이머 시작

- `⏸`
  - EN: Pause timer
  - KO: 타이머 일시정지

- `↺`
  - EN: Reset timer
  - KO: 타이머 리셋

- Top drag zone
  - EN: Drag overlay window
  - KO: 상단 드래그 영역으로 오버레이 이동

- Bottom-right resize handle
  - EN: Resize overlay
  - KO: 우하단 핸들로 오버레이 크기 조절

## 4. Data & Privacy / 데이터와 프라이버시

- EN: Mail account/password and Google tokens are stored locally on your machine (Electron userData).
- KO: 메일 계정/비밀번호와 구글 토큰은 로컬 PC(Electron userData)에 저장됩니다.

- EN: Do not commit personal secrets to GitHub.
- KO: 개인 비밀정보(비밀번호/토큰)는 GitHub에 커밋하지 마세요.

## 5. Main Files / 주요 파일

- `electron/main.cjs`: Electron main process
- `electron/preload.cjs`: secure bridge APIs
- `src/App.tsx`: main UI and logic
- `src/styles.css`: UI styles

