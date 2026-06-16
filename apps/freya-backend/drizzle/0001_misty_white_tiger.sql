CREATE INDEX "user_sources_user_id_enabled_idx" ON "user_sources" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE TABLE "conversation_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"file_id" uuid,
	"payload" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_entries_conversation_id_sequence_unique" UNIQUE("conversation_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "conversation_entries" ADD CONSTRAINT "conversation_entries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_entries" ADD CONSTRAINT "conversation_entries_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_entries" ADD CONSTRAINT "conversation_entries_attachment_file_id_check" CHECK (("conversation_entries"."kind" = 'attachment' and "conversation_entries"."file_id" is not null) or ("conversation_entries"."kind" <> 'attachment' and "conversation_entries"."file_id" is null));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_entries_conversation_id_sequence_idx" ON "conversation_entries" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_entries_conversation_id_visibility_sequence_idx" ON "conversation_entries" USING btree ("conversation_id","visibility","sequence");--> statement-breakpoint
CREATE INDEX "conversation_entries_kind_idx" ON "conversation_entries" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "conversation_entries_file_id_idx" ON "conversation_entries" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "files_user_id_created_at_idx" ON "files" USING btree ("user_id","created_at");
