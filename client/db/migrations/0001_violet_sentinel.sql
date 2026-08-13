CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`output` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`recurrence_rule` text NOT NULL,
	`linked_agent` text,
	`task_prompt` text NOT NULL,
	`last_run` integer,
	`next_run` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
