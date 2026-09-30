CREATE TABLE `message_vectors` (
	`message_id` text PRIMARY KEY NOT NULL,
	`embedding` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
