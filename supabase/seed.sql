-- Starter scouting fields. Everything here is editable (or archivable) from the
-- Settings page; none of it is hardcoded in the app.
--
-- This runs on `supabase db reset` (local). For the hosted project, the same
-- rows are inserted by a separate, idempotent step only if you choose to run it.
-- Dropdown option tones: good | neutral | bad.

insert into public.field_definitions
  (name, section, type, options, higher_is_better, good_threshold, bad_threshold, good_answer, sort_order)
values
  -- specs ------------------------------------------------------------------
  ('Drivetrain', 'specs', 'dropdown',
    '[{"value":"swerve","label":"Swerve","tone":"good"},
      {"value":"tank","label":"Tank / West Coast","tone":"neutral"},
      {"value":"mecanum","label":"Mecanum","tone":"bad"},
      {"value":"other","label":"Other","tone":"neutral"}]'::jsonb,
    null, null, null, null, 10),

  ('Robot weight (lbs)', 'specs', 'number', null,
    false, 110, 125, null, 20),

  ('Programming language', 'specs', 'dropdown',
    '[{"value":"java","label":"Java","tone":"neutral"},
      {"value":"cpp","label":"C++","tone":"neutral"},
      {"value":"python","label":"Python","tone":"neutral"},
      {"value":"labview","label":"LabVIEW","tone":"neutral"},
      {"value":"other","label":"Other","tone":"neutral"}]'::jsonb,
    null, null, null, null, 30),

  ('Mechanisms', 'specs', 'text', null,
    null, null, null, null, 40),

  ('Robot looks well built', 'specs', 'yes_no', null,
    null, null, null, true, 50),

  -- auto -------------------------------------------------------------------
  ('Has an autonomous routine', 'auto', 'yes_no', null,
    null, null, null, true, 10),

  ('Auto pieces scored', 'auto', 'number', null,
    true, 3, 1, null, 20),

  ('Auto leaves starting zone', 'auto', 'yes_no', null,
    null, null, null, true, 30),

  ('Auto notes', 'auto', 'text', null,
    null, null, null, null, 40),

  -- endgame ----------------------------------------------------------------
  ('Can climb', 'endgame', 'yes_no', null,
    null, null, null, true, 10),

  ('Climb level', 'endgame', 'dropdown',
    '[{"value":"none","label":"None","tone":"bad"},
      {"value":"park","label":"Park only","tone":"neutral"},
      {"value":"low","label":"Low","tone":"neutral"},
      {"value":"mid","label":"Mid","tone":"good"},
      {"value":"high","label":"High / Traversal","tone":"good"}]'::jsonb,
    null, null, null, null, 20),

  ('Climb time (seconds)', 'endgame', 'number', null,
    false, 8, 15, null, 30),

  -- other ------------------------------------------------------------------
  ('Can play defense', 'other', 'yes_no', null,
    null, null, null, true, 10),

  ('Drive team seems prepared', 'other', 'yes_no', null,
    null, null, null, true, 20),

  ('Needs repairs / had breakdowns', 'other', 'yes_no', null,
    null, null, null, false, 30);
