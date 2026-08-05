-- ============================================================================
-- Fictional seed data.
--
-- Every person, phone number, email address and stock number below is invented.
-- Phone numbers use the 555-01xx range reserved for fiction.
--
-- Re-runnable: it deletes rows tagged source = 'seed' before inserting.
--
--   Local:  supabase db reset            (runs this file automatically)
--   Hosted: paste into the SQL editor, then
--             select public.seed_demo_data((select id from auth.users
--                                           order by created_at limit 1));
-- ============================================================================

create or replace function public.seed_demo_data(target_user_id uuid)
returns text
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  -- Fixed ids keep the seed re-runnable and easy to reference from tests.
  c_ayala      uuid := '10000000-0000-4000-8000-000000000001';
  c_whitfield  uuid := '10000000-0000-4000-8000-000000000002';
  c_kobayashi  uuid := '10000000-0000-4000-8000-000000000003';
  c_okonkwo    uuid := '10000000-0000-4000-8000-000000000004';
  c_lindqvist  uuid := '10000000-0000-4000-8000-000000000005';
  c_raghu      uuid := '10000000-0000-4000-8000-000000000006';
  c_brummett   uuid := '10000000-0000-4000-8000-000000000007';
  c_dagenais   uuid := '10000000-0000-4000-8000-000000000008';
  c_vandergriff uuid := '10000000-0000-4000-8000-000000000009';
  c_mbeki      uuid := '10000000-0000-4000-8000-00000000000a';
  c_delacroix  uuid := '10000000-0000-4000-8000-00000000000b';
  s_lindqvist  uuid := '20000000-0000-4000-8000-000000000001';
  s_pending    uuid := '20000000-0000-4000-8000-000000000002';
  n_reminder   uuid := '30000000-0000-4000-8000-000000000001';
  cmd_voice    uuid := '40000000-0000-4000-8000-000000000001';
  -- "Tomorrow at ten", the example from the product brief.
  tomorrow_10  timestamptz := (date_trunc('day', now()) + interval '1 day' + interval '10 hours');
begin
  if target_user_id is null then
    raise exception 'seed_demo_data needs a user id; sign up first, then pass that auth.users id';
  end if;

  -- Clear previous seed rows. Child rows cascade from customers.
  delete from public.notification_log where user_id = target_user_id and provider = 'seed';
  delete from public.inbound_commands where user_id = target_user_id and provider = 'seed';
  delete from public.screenshots where user_id = target_user_id and id in (s_lindqvist, s_pending);
  delete from public.customers where user_id = target_user_id and source = 'seed';

  -- -------------------------------------------------------------------------
  -- customers, one per lifecycle state the product cares about
  -- -------------------------------------------------------------------------
  insert into public.customers (
    id, user_id, full_name, first_name, last_name, primary_phone, primary_email,
    dealership_customer_id, city, state, preferred_language, salesperson, lead_source,
    lead_priority, lead_temperature, lead_status, notes, source, last_activity_at, archived_at,
    created_at
  ) values
    (c_ayala, target_user_id, 'Jesus Ayala', 'Jesus', 'Ayala', '+15550100114', 'jesus.ayala@example.com',
     'RV-100114', 'Abilene', 'TX', 'es', 'Me', 'Website form',
     'high', 'hot', 'follow_up_scheduled', 'Wants a bunkhouse travel trailer under 30 feet. Tows with a half-ton.',
     'seed', now() - interval '3 hours', null, now() - interval '9 days'),

    (c_whitfield, target_user_id, 'Marcy Whitfield', 'Marcy', 'Whitfield', '+15550100127', 'm.whitfield@example.com',
     'RV-100127', 'Lubbock', 'TX', 'en', 'Me', 'Walk-in',
     'normal', 'warm', 'waiting_on_customer', 'Sent trade-in appraisal. Waiting on her to confirm payoff amount.',
     'seed', now() - interval '2 days', null, now() - interval '16 days'),

    (c_kobayashi, target_user_id, 'Dwight Kobayashi', 'Dwight', 'Kobayashi', '+15550100138', 'dkobayashi@example.com',
     'RV-100138', 'Midland', 'TX', 'en', 'Me', 'RV show',
     'urgent', 'hot', 'appointment_scheduled', 'Coming in Saturday with his wife to walk two fifth wheels.',
     'seed', now() - interval '20 hours', null, now() - interval '5 days'),

    -- No follow-up on purpose: this is the customer the app exists to rescue.
    (c_okonkwo, target_user_id, 'Renata Okonkwo', 'Renata', 'Okonkwo', '+15550100142', 'renata.okonkwo@example.com',
     'RV-100142', 'San Angelo', 'TX', 'en', 'Me', 'Phone-up',
     'high', 'warm', 'working', 'Asked about towing capacity for a Class C. Never got a straight answer back to her.',
     'seed', now() - interval '4 days', null, now() - interval '11 days'),

    -- Also no follow-up: freshly imported from a screenshot, untouched.
    (c_lindqvist, target_user_id, 'Travis Lindqvist', 'Travis', 'Lindqvist', '+15550100155', null,
     'RV-100155', 'Sweetwater', 'TX', 'unknown', 'Me', 'Internet lead',
     'normal', 'unknown', 'new', 'Imported from a CRM screenshot. Nothing attempted yet.',
     'seed', now() - interval '1 day', null, now() - interval '1 day'),

    (c_raghu, target_user_id, 'Priya Raghunathan', 'Priya', 'Raghunathan', '+15550100163', 'priya.r@example.com',
     'RV-100163', 'Odessa', 'TX', 'en', 'Me', 'Referral',
     'high', 'warm', 'follow_up_scheduled', 'Comparing our toy hauler against a competitor two hours away.',
     'seed', now() - interval '6 days', null, now() - interval '21 days'),

    (c_brummett, target_user_id, 'Hal Brummett', 'Hal', 'Brummett', '+15550100171', 'hal.brummett@example.com',
     'RV-100171', 'Big Spring', 'TX', 'en', 'Me', 'Repeat customer',
     'normal', 'hot', 'sold', 'Delivered. Reminded him about the 90-day service check.',
     'seed', now() - interval '8 days', null, now() - interval '40 days'),

    (c_dagenais, target_user_id, 'Corinne Dagenais', 'Corinne', 'Dagenais', '+15550100184', 'c.dagenais@example.com',
     'RV-100184', 'Snyder', 'TX', 'en', 'Me', 'Website form',
     'low', 'cold', 'lost', 'Bought used from a private seller. Asked to be kept in mind for next year.',
     'seed', now() - interval '18 days', null, now() - interval '52 days'),

    (c_vandergriff, target_user_id, 'Otis Vandergriff', 'Otis', 'Vandergriff', '+15550100196', null,
     'RV-100196', 'Colorado City', 'TX', 'en', 'Me', 'Cold list',
     'low', 'cold', 'do_not_contact', 'Asked not to be contacted again. Honor this.',
     'seed', now() - interval '30 days', null, now() - interval '61 days'),

    (c_mbeki, target_user_id, 'Suzanne Mbeki', 'Suzanne', 'Mbeki', '+15550100203', 'suzanne.mbeki@example.com',
     'RV-100203', 'Brownwood', 'TX', 'en', 'Me', 'Internet lead',
     'low', 'cold', 'archived', 'Went quiet for three months. Archived to keep the active list honest.',
     'seed', now() - interval '95 days', now() - interval '7 days', now() - interval '120 days'),

    (c_delacroix, target_user_id, 'Frankie Delacroix', 'Frankie', 'Delacroix', '+15550100218', 'frankie.d@example.com',
     'RV-100218', 'Abilene', 'TX', 'en', 'Me', 'Service department',
     'normal', 'warm', 'follow_up_scheduled', 'In for service, mentioned upgrading to a bigger fifth wheel next spring.',
     'seed', now() - interval '9 days', null, now() - interval '25 days');

  -- -------------------------------------------------------------------------
  -- contact methods — what is *available*, independent of what was tried
  -- -------------------------------------------------------------------------
  insert into public.customer_contact_methods
    (user_id, customer_id, method, value, label, is_primary, is_verified, opted_out, source)
  values
    (target_user_id, c_ayala, 'phone_call', '+15550100114', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_ayala, 'sms', '+15550100114', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_ayala, 'whatsapp', '+15550100114', 'Mobile', true, false, false, 'seed'),
    (target_user_id, c_ayala, 'email', 'jesus.ayala@example.com', 'Personal', true, false, false, 'seed'),

    (target_user_id, c_whitfield, 'phone_call', '+15550100127', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_whitfield, 'email', 'm.whitfield@example.com', 'Personal', true, true, false, 'seed'),

    (target_user_id, c_kobayashi, 'phone_call', '+15550100138', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_kobayashi, 'sms', '+15550100138', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_kobayashi, 'email', 'dkobayashi@example.com', 'Work', true, false, false, 'seed'),

    (target_user_id, c_okonkwo, 'phone_call', '+15550100142', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_okonkwo, 'sms', '+15550100142', 'Mobile', true, false, false, 'seed'),
    (target_user_id, c_okonkwo, 'email', 'renata.okonkwo@example.com', 'Personal', true, false, false, 'seed'),

    (target_user_id, c_lindqvist, 'phone_call', '+15550100155', 'Mobile', true, false, false, 'seed'),
    (target_user_id, c_lindqvist, 'sms', '+15550100155', 'Mobile', true, false, false, 'seed'),

    (target_user_id, c_raghu, 'phone_call', '+15550100163', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_raghu, 'email', 'priya.r@example.com', 'Personal', true, true, false, 'seed'),
    (target_user_id, c_raghu, 'sms', '+15550100163', 'Mobile', true, false, false, 'seed'),

    (target_user_id, c_brummett, 'phone_call', '+15550100171', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_dagenais, 'email', 'c.dagenais@example.com', 'Personal', true, true, false, 'seed'),

    -- Opted out: available in the CRM, but the app must never suggest it.
    (target_user_id, c_vandergriff, 'phone_call', '+15550100196', 'Mobile', true, true, true, 'seed'),

    (target_user_id, c_mbeki, 'email', 'suzanne.mbeki@example.com', 'Personal', true, false, false, 'seed'),
    (target_user_id, c_delacroix, 'phone_call', '+15550100218', 'Mobile', true, true, false, 'seed'),
    (target_user_id, c_delacroix, 'sms', '+15550100218', 'Mobile', true, true, false, 'seed');

  -- -------------------------------------------------------------------------
  -- vehicle interests
  -- -------------------------------------------------------------------------
  insert into public.vehicle_interests
    (user_id, customer_id, model_year, make, model, floorplan, stock_number, condition, is_primary, notes, source)
  values
    (target_user_id, c_ayala, 2024, 'Cedar Ridge', 'Trailblazer', '28BHS', 'STK-48211', 'new', true,
     'Bunkhouse, wants the outdoor kitchen option.', 'seed'),
    (target_user_id, c_ayala, 2022, 'Cedar Ridge', 'Trailblazer', '26BH', 'STK-47008', 'used', false,
     'Backup option if the 2024 payment is too high.', 'seed'),
    (target_user_id, c_whitfield, 2023, 'Northwind', 'Sierra Sky', '31RL', 'STK-48044', 'used', true,
     'Rear living, trading in a 2016 pop-up.', 'seed'),
    (target_user_id, c_kobayashi, 2025, 'Ironwood', 'Summit', '38FL', 'STK-48590', 'new', true,
     'Front living fifth wheel, needs a dually to tow.', 'seed'),
    (target_user_id, c_okonkwo, 2024, 'Harborview', 'Voyager', 'C24', 'STK-48332', 'new', true,
     'Class C, asked specifically about towing a small SUV.', 'seed'),
    (target_user_id, c_lindqvist, null, 'Cedar Ridge', null, null, null, 'unknown', true,
     'Screenshot only listed the brand.', 'seed'),
    (target_user_id, c_raghu, 2024, 'Ironwood', 'Havoc', '3616', 'STK-48477', 'new', true,
     'Toy hauler for two side-by-sides.', 'seed'),
    (target_user_id, c_brummett, 2024, 'Northwind', 'Sierra Sky', '29BH', 'STK-48120', 'new', true,
     'Sold and delivered.', 'seed'),
    (target_user_id, c_delacroix, 2026, 'Ironwood', 'Summit', '36RL', null, 'new', true,
     'Wants to see next model year inventory when it lands.', 'seed');

  -- -------------------------------------------------------------------------
  -- activities
  --
  -- performed_by_user distinguishes what I did from what merely showed up in a
  -- CRM screenshot. Screenshot-imported rows are false even when they describe
  -- an outbound call, because someone else may have made it.
  -- -------------------------------------------------------------------------
  insert into public.activities
    (user_id, customer_id, type, direction, method, outcome, summary, occurred_at, source, performed_by_user)
  values
    (target_user_id, c_ayala, 'outbound_call', 'outbound', 'phone_call', 'no_answer',
     'Called about the 28BHS. No answer, no voicemail box set up.', now() - interval '3 hours', 'manual', true),
    (target_user_id, c_ayala, 'outbound_text', 'outbound', 'sms', 'no_reply',
     'Texted a photo of the outdoor kitchen.', now() - interval '2 days', 'manual', true),
    (target_user_id, c_ayala, 'inbound_call', 'inbound', 'phone_call', 'connected',
     'He called in asking about payment on the 2022 unit.', now() - interval '4 days', 'manual', false),

    (target_user_id, c_whitfield, 'outbound_email', 'outbound', 'email', 'no_reply',
     'Emailed the trade appraisal worksheet.', now() - interval '2 days', 'manual', true),
    (target_user_id, c_whitfield, 'outbound_call', 'outbound', 'phone_call', 'left_voicemail',
     'Left voicemail asking for the payoff amount.', now() - interval '3 days', 'manual', true),

    (target_user_id, c_kobayashi, 'appointment', 'outbound', 'in_person', 'appointment_set',
     'Saturday 10:00 walkthrough booked for two fifth wheels.', now() - interval '20 hours', 'manual', true),
    (target_user_id, c_kobayashi, 'outbound_text', 'outbound', 'sms', 'replied',
     'Confirmed the appointment time by text.', now() - interval '22 hours', 'manual', true),

    (target_user_id, c_okonkwo, 'outbound_call', 'outbound', 'phone_call', 'connected',
     'Talked through Class C towing limits, promised to send the spec sheet. Never sent it.',
     now() - interval '4 days', 'manual', true),
    -- Visible in the CRM, but not something I did.
    (target_user_id, c_okonkwo, 'outbound_email', 'outbound', 'email', 'no_reply',
     'CRM shows an automated brochure email went out.', now() - interval '10 days', 'screenshot', false),

    (target_user_id, c_lindqvist, 'screenshot_import', 'internal', null, null,
     'Created from a CRM screenshot. No contact attempted yet.', now() - interval '1 day', 'screenshot', false),
    (target_user_id, c_lindqvist, 'outbound_text', 'outbound', 'sms', 'no_reply',
     'CRM screenshot shows an auto-responder text from the internet lead tool.',
     now() - interval '1 day', 'screenshot', false),

    (target_user_id, c_raghu, 'outbound_call', 'outbound', 'phone_call', 'connected',
     'Went over the Havoc 3616 against the competitor quote.', now() - interval '6 days', 'manual', true),
    (target_user_id, c_raghu, 'inbound_email', 'inbound', 'email', 'replied',
     'She sent over the competitor quote as a PDF.', now() - interval '5 days', 'manual', false),

    (target_user_id, c_brummett, 'in_person', 'outbound', 'in_person', 'sold',
     'Signed and delivered the 29BH.', now() - interval '8 days', 'manual', true),
    (target_user_id, c_dagenais, 'outbound_call', 'outbound', 'phone_call', 'not_interested',
     'She bought private party. Asked to check back next season.', now() - interval '18 days', 'manual', true),
    (target_user_id, c_vandergriff, 'inbound_call', 'inbound', 'phone_call', 'not_interested',
     'Asked to be removed from all contact.', now() - interval '30 days', 'manual', false),
    (target_user_id, c_delacroix, 'in_person', 'outbound', 'in_person', 'connected',
     'Chatted in the service lane about upgrading next spring.', now() - interval '9 days', 'manual', true);

  -- -------------------------------------------------------------------------
  -- follow-ups — every non-terminal customer except Okonkwo and Lindqvist,
  -- who are left bare so the no-next-action queue has something to show.
  -- -------------------------------------------------------------------------
  insert into public.follow_ups
    (user_id, customer_id, due_at, status, priority, reason, recommended_method,
     waiting_until, completed_at, snoozed_until, reminder_status, source)
  values
    (target_user_id, c_ayala, tomorrow_10, 'pending', 'high',
     'Retry the call about the 28BHS after no answer.', 'phone_call',
     null, null, null, 'scheduled', 'seed'),

    (target_user_id, c_whitfield, now() + interval '4 days', 'waiting_on_customer', 'normal',
     'Waiting on her payoff amount before the trade number is real.', 'email',
     now() + interval '4 days', null, null, 'not_scheduled', 'seed'),

    (target_user_id, c_kobayashi, now() + interval '2 days', 'pending', 'urgent',
     'Confirm Saturday walkthrough the day before.', 'sms',
     null, null, null, 'scheduled', 'seed'),

    -- Overdue: the exact failure mode this app is meant to catch.
    (target_user_id, c_raghu, now() - interval '2 days', 'overdue', 'high',
     'Promised a written response to the competitor quote.', 'email',
     null, null, null, 'sent', 'seed'),

    (target_user_id, c_delacroix, now() + interval '21 days', 'snoozed', 'low',
     'Check back when next model year inventory arrives.', 'phone_call',
     null, null, now() + interval '21 days', 'not_scheduled', 'seed'),

    (target_user_id, c_brummett, now() - interval '8 days', 'completed', 'normal',
     'Delivery paperwork follow-up.', 'phone_call',
     null, now() - interval '8 days', null, 'sent', 'seed');

  -- -------------------------------------------------------------------------
  -- screenshots + extracted fields (Phase 1 stores the shape only; nothing
  -- here was produced by a real OCR run)
  -- -------------------------------------------------------------------------
  insert into public.screenshots
    (id, user_id, customer_id, file_hash, storage_path, mime_type, byte_size, status,
     extraction_provider, extraction_started_at, extraction_finished_at, raw_text, captured_at, applied_at)
  values
    (s_lindqvist, target_user_id, c_lindqvist,
     repeat('a1', 32), null, 'image/png', 184320, 'applied',
     'seed', now() - interval '1 day', now() - interval '1 day',
     E'Customer: Travis Lindqvist\nID: RV-100155\nPhone: (555) 010-0155\nCity: Sweetwater, TX\nSource: Internet lead\nInterest: Cedar Ridge',
     now() - interval '1 day', now() - interval '1 day'),
    (s_pending, target_user_id, null,
     repeat('b2', 32), null, 'image/png', 210044, 'needs_review',
     'seed', now() - interval '2 hours', now() - interval '2 hours',
     E'Customer: Renata Okonkwo\nID: RV-100142\nPhone: (555) 010-0142\nStatus: Working\nLast contact: 4 days ago',
     now() - interval '2 hours', null);

  insert into public.screenshot_extraction_fields
    (user_id, screenshot_id, field_key, field_value, confidence, accepted, applied_at)
  values
    (target_user_id, s_lindqvist, 'full_name', 'Travis Lindqvist', 0.960, true, now() - interval '1 day'),
    (target_user_id, s_lindqvist, 'dealership_customer_id', 'RV-100155', 0.990, true, now() - interval '1 day'),
    (target_user_id, s_lindqvist, 'primary_phone', '(555) 010-0155', 0.940, true, now() - interval '1 day'),
    (target_user_id, s_lindqvist, 'city', 'Sweetwater', 0.910, true, now() - interval '1 day'),
    (target_user_id, s_pending, 'full_name', 'Renata Okonkwo', 0.880, null, null),
    (target_user_id, s_pending, 'dealership_customer_id', 'RV-100142', 0.970, null, null),
    (target_user_id, s_pending, 'lead_status', 'Working', 0.620, null, null);

  insert into public.customer_match_candidates
    (user_id, customer_id, screenshot_id, score, match_signals, selected)
  values
    (target_user_id, c_okonkwo, s_pending, 0.940,
     '{"dealership_customer_id": "exact", "normalized_name": "exact"}'::jsonb, false);

  -- -------------------------------------------------------------------------
  -- WhatsApp traffic — the shape of a reminder and a voice-note reply.
  -- provider = 'seed' marks these as fixtures, never real sends.
  -- -------------------------------------------------------------------------
  insert into public.notification_log
    (id, user_id, customer_id, follow_up_id, channel, kind, status, idempotency_key,
     provider, provider_message_id, template_name, payload_summary, billable, attempt_count,
     scheduled_for, sent_at, delivered_at)
  values
    (n_reminder, target_user_id, c_ayala, null, 'whatsapp', 'follow_up_reminder', 'delivered',
     'seed:follow_up_reminder:ayala:' || to_char(now(), 'YYYY-MM-DD'),
     'seed', 'seed-wamid-0001', 'follow_up_reminder_v1',
     '1 follow-up due: Jesus Ayala 10:00', true, 1,
     now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours'),
    (gen_random_uuid(), target_user_id, null, null, 'whatsapp', 'morning_summary', 'delivered',
     'seed:morning_summary:' || to_char(now(), 'YYYY-MM-DD'),
     'seed', 'seed-wamid-0002', 'morning_summary_v1',
     '3 due today, 1 overdue, 2 with no next action', true, 1,
     now() - interval '9 hours', now() - interval '9 hours', now() - interval '9 hours'),
    (gen_random_uuid(), target_user_id, c_ayala, null, 'whatsapp', 'command_confirmation', 'sent',
     'seed:command_confirmation:' || cmd_voice::text,
     'seed', 'seed-wamid-0003', null,
     'Logged call, follow-up set for tomorrow 10:00', false, 1,
     now() - interval '3 hours', now() - interval '3 hours', null);

  insert into public.inbound_commands
    (id, user_id, customer_id, channel, status, provider, provider_message_id, from_number_e164,
     is_approved_sender, raw_text, transcript, transcript_provider, transcript_confidence,
     audio_deleted_at, audio_duration_seconds, parsed_intent, parsed_payload, parse_confidence,
     reply_notification_id, received_at, processed_at)
  values
    (cmd_voice, target_user_id, c_ayala, 'whatsapp_voice', 'applied',
     'seed', 'seed-wamid-in-0001', '+15550100999', true,
     null,
     'Called Jesus Ayala. No answer. Follow up tomorrow at ten.',
     'seed', 0.930,
     now() - interval '3 hours', 7,
     'log_activity_and_schedule',
     jsonb_build_object(
       'customer_name', 'Jesus Ayala',
       'activity_type', 'outbound_call',
       'outcome', 'no_answer',
       'follow_up_at', to_char(tomorrow_10 at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
     ),
     0.910, n_reminder, now() - interval '3 hours', now() - interval '3 hours'),

    -- Recorded but never acted upon: the number is not the approved one.
    (gen_random_uuid(), target_user_id, null, 'whatsapp_text', 'rejected',
     'seed', 'seed-wamid-in-0002', '+15550100777', false,
     'mark everyone sold', null, null, null, null, null,
     null, '{}'::jsonb, null, null, now() - interval '1 day', now() - interval '1 day');

  insert into public.audit_log (user_id, action, table_name, record_id, summary, metadata, source)
  values
    (target_user_id, 'insert', 'customers', c_lindqvist,
     'Customer created from screenshot import', '{"screenshot_status": "applied"}'::jsonb, 'screenshot'),
    (target_user_id, 'update', 'follow_ups', null,
     'Follow-up scheduled from WhatsApp voice note', '{"intent": "log_activity_and_schedule"}'::jsonb, 'voice_note'),
    (target_user_id, 'access_denied', 'inbound_commands', null,
     'Command rejected: sender is not the approved WhatsApp number', '{"reason": "unapproved_sender"}'::jsonb, 'whatsapp');

  update public.profiles
     set display_name = coalesce(display_name, 'RV Sales'),
         time_zone = 'America/Chicago'
   where id = target_user_id;

  return format(
    'Seeded %s customers for user %s. Two are intentionally left with no next action.',
    11, target_user_id
  );
end;
$$;

comment on function public.seed_demo_data is
  'Loads fictional demo data for one user. Safe to re-run; replaces rows tagged source = seed.';

-- Local development: seed the first user if one exists. On a fresh `supabase db
-- reset` there is no user yet, so this is a no-op until after the first signup.
do $$
declare
  first_user uuid;
begin
  select id into first_user from auth.users order by created_at limit 1;
  if first_user is null then
    raise notice 'No auth user yet — sign up, then run: select public.seed_demo_data(''<user-id>'');';
  else
    perform public.seed_demo_data(first_user);
    raise notice 'Seeded demo data for %', first_user;
  end if;
end
$$;
