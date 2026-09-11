BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_inbound_message_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event_id uuid;
  v_payload jsonb;
BEGIN
  v_payload := jsonb_build_object(
    'id', NEW.id,
    'provider_message_id', NEW.provider_message_id,
    'phone_number_id', NEW.phone_number_id,
    'from', NEW.sender,
    'to', NEW.recipient,
    'body', NEW.body,
    'country_code', NEW.country_code,
    'status', NEW.status,
    'received_at', NEW.received_at,
    'metadata', NEW.metadata
  );

  INSERT INTO public.message_events(message_id, provider_event_id, event_type, payload)
  VALUES (NEW.id, NEW.provider_message_id, 'sms.received', v_payload)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.message_events
    WHERE message_id = NEW.id AND event_type = 'sms.received'
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  INSERT INTO public.notifications(
    user_id, type, title, body, resource_type, resource_id
  )
  VALUES (
    NEW.user_id,
    'sms.received',
    'New SMS received',
    left(NEW.body, 500),
    'inbound_message',
    NEW.id::text
  );

  INSERT INTO public.webhook_deliveries(
    webhook_id, event, request_id, attempt, status, payload, next_retry_at
  )
  SELECT
    w.id,
    w.event,
    v_event_id::text,
    1,
    'pending',
    jsonb_build_object(
      'id', v_event_id,
      'event', w.event,
      'created_at', now(),
      'data', v_payload
    ),
    now()
  FROM public.webhooks w
  WHERE w.user_id = NEW.user_id
    AND w.status = 'active'
    AND w.event = 'sms.received';

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE
ON FUNCTION public.enqueue_inbound_message_events()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.enqueue_inbound_message_events()
TO service_role;

COMMIT;
