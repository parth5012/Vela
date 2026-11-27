# Blackbox Test Specification: Task Management Full UI

**Ticket:** Blackbox Test: Task Management Full UI (#1170)  
**Map:** Wayfinder Map: Task Management Full UI (#616)  

## Test Scenarios & Oracles

### Scenario 1: Custom Cron Schedule Picker
- **Given** user opens the task creation modal,
- **When** user selects "Custom Cron" schedule option,
- **Then** a cron input field appears with placeholder `0 9 * * 1-5`,
- **And** typing a valid cron expression displays the human-readable description (e.g. `At 09:00 on weekdays`),
- **And** typing an invalid cron expression displays `Invalid cron expression (e.g. 0 9 * * 1-5)`,
- **And** saving the task persists the custom cron expression into `tasks.recurrence_rule`.

### Scenario 2: Enriched Status Badges
- **Given** a list of scheduled tasks with run history,
- **When** rendering task cards,
- **Then** each task displays its lifecycle status badge (`ACTIVE` or `PAUSED`),
- **And** if a prior execution exists, displays the last run outcome badge (`SUCCESS` / `FAILED`).

### Scenario 3: Task Notification Banner Card
- **Given** a recent task execution has occurred,
- **When** user views the Tasks screen,
- **Then** a dismissible summary banner card appears at the top of the screen showing:
  - Task title and status indicator (Completed or Failed),
  - Execution timestamp / duration,
  - Quick action button to view run logs,
- **And** tapping the dismiss button removes the banner card.

### Scenario 4: Detail View & Execution Run History
- **Given** user taps on a task card,
- **When** the task detail modal opens,
- **Then** execution history lists runs with timestamp, duration, status badge, and full output/log,
- **And** history is bounded to the configured retention limit (`taskHistoryRetention`).

## Test File
- Executable Jest suite: `client/__tests__/taskManagementBlackbox.test.tsx`
