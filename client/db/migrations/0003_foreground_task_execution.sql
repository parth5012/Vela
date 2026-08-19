-- 0003_foreground_task_execution
CREATE TABLE `task_executions` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  `backend_run_id` text,
  `status` text NOT NULL DEFAULT 'pending',
  `current_step_index` integer NOT NULL DEFAULT 0,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `cancelled` integer DEFAULT 0 NOT NULL,
  `interrupted` integer DEFAULT 0 NOT NULL,
  `awaiting_approval` integer DEFAULT 0 NOT NULL,
  `task_plan` text,
  `last_action` text
);--> statement-breakpoint
CREATE TABLE `task_step_executions` (
  `id` text PRIMARY KEY NOT NULL,
  `execution_id` text NOT NULL REFERENCES `task_executions` (`id`) ON DELETE CASCADE,
  `step_index` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `output` text
);
