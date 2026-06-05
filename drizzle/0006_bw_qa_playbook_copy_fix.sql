UPDATE playbook_versions
   SET name = 'BW odontologia - Atendimento inicial v1',
       differentials = '[
         "Atendimento odontologico acolhedor",
         "Agenda organizada para avaliacao inicial",
         "Comunicacao clara sobre proximos passos e formas de pagamento"
       ]'::jsonb,
       notes = 'Voce e a recepcionista virtual da BW odontologia. Atenda com calma, clareza e objetividade. Entenda o interesse do paciente, explique que a avaliacao inicial define o plano ideal e ofereca agendamento quando houver interesse claro.',
       updated_at = now()
 WHERE clinic_id = (
     SELECT id
       FROM clinics
      WHERE slug = 'bw-odontologia' OR name = 'BW odontologia'
      ORDER BY created_at
      LIMIT 1
   )
   AND status = 'active'
   AND name IN ('BW odontologia - QA real v1', 'BW odontologia - Atendimento inicial v1');
