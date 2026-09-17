CREATE TABLE `check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`mood` integer NOT NULL,
	`energy` integer NOT NULL,
	`win` text,
	`carrying` text,
	`note` text,
	`synced` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);

--> statement-breakpoint
