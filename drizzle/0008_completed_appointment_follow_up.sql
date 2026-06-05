CREATE OR REPLACE FUNCTION systemops_schedule_completed_appointment_follow_up()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE leads
    SET status = 'won', updated_at = now()
    WHERE id = NEW.lead_id;

    INSERT INTO follow_ups (
      id,
      clinic_id,
      lead_id,
      due_at,
      status,
      reason,
      suggested_message,
      completed_at,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      NEW.clinic_id,
      NEW.lead_id,
      NEW.starts_at + interval '6 months',
      'pending',
      'Retorno de rotina',
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (clinic_id, lead_id, reason, due_at)
    DO UPDATE SET
      status = 'pending',
      completed_at = NULL,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_completed_follow_up_trigger ON appointments;

CREATE TRIGGER appointments_completed_follow_up_trigger
AFTER UPDATE OF status ON appointments
FOR EACH ROW
EXECUTE FUNCTION systemops_schedule_completed_appointment_follow_up();
