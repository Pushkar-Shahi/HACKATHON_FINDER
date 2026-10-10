-- Seed the platform registry. Every provider starts in Manual Mode: no
-- automated integration is assumed until an operator configures an authorized
-- feed and a sync genuinely succeeds. Timestamps use epoch milliseconds.
INSERT INTO `platforms` (`id`, `name`, `homepage_url`, `integration_mode`, `integration_status`, `auto_sync_enabled`, `created_at`, `updated_at`) VALUES
  ('devpost', 'Devpost', 'https://devpost.com/', 'authorized_feed', 'connected', 1, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
  ('machinehack', 'MachineHack', 'https://machinehack.com/', 'manual', 'manual_mode', 0, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
  ('mlh', 'Major League Hacking (MLH)', 'https://www.mlh.com/', 'authorized_feed', 'connected', 1, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
  ('unstop', 'Unstop', 'https://unstop.com/', 'authorized_feed', 'connected', 1, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
  ('other', 'Other / direct', 'https://example.invalid/', 'manual', 'manual_mode', 0, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer));
