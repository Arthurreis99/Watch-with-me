CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`participant_id` text NOT NULL,
	`sender_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_room_created_at` ON `messages` (`room_code`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
