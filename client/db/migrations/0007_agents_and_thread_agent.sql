ALTER TABLE `threads` RENAME COLUMN "persona" TO "agent";--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`system_prompt` text NOT NULL,
	`compact_prompt_instructions` text,
	`model` text,
	`is_preset` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
