DO $$
DECLARE
  v_source_clinic_id uuid;
  v_target_clinic_id uuid;
BEGIN
  SELECT id
    INTO v_source_clinic_id
    FROM clinics
   WHERE (slug = 'ximendes' OR name = 'Ximendes Odontologia')
     AND zapi_instance_id IS NOT NULL
   ORDER BY created_at
   LIMIT 1;

  SELECT id
    INTO v_target_clinic_id
    FROM clinics
   WHERE slug = 'bw-odontologia' OR name = 'BW odontologia'
   ORDER BY created_at
   LIMIT 1;

  IF v_target_clinic_id IS NULL THEN
    v_target_clinic_id := gen_random_uuid();

    INSERT INTO clinics (
      id,
      name,
      slug,
      specialty,
      city,
      address,
      timezone,
      conversation_experience,
      greeting_message,
      menu_items,
      business_hours,
      calendar_mode,
      auto_reply_enabled,
      takeover_ttl_hours,
      post_appointment_buffer_minutes,
      default_appointment_duration_minutes,
      plan,
      monthly_revenue_brl,
      is_test,
      receptionist_phone,
      channel_provider,
      zapi_instance_id,
      zapi_token,
      zapi_client_token,
      meta_phone_number_id,
      meta_access_token,
      created_at,
      updated_at
    ) VALUES (
      v_target_clinic_id,
      'BW odontologia',
      'bw-odontologia',
      'Odontologia',
      'Sao Paulo',
      NULL,
      'America/Sao_Paulo',
      'concierge',
      'Ola! Sou a recepcionista virtual da BW odontologia. Posso ajudar com informacoes, valores da avaliacao e agendamentos. Como posso ajudar?',
      '[
        {"number":1,"label":"Tratamentos odontologicos","intent":"procedures","enabled":true},
        {"number":2,"label":"Agendar avaliacao","intent":"book_appointment","enabled":true},
        {"number":3,"label":"Valores e formas de pagamento","intent":"price_inquiry","enabled":true},
        {"number":4,"label":"Endereco e horarios","intent":"location","enabled":true},
        {"number":5,"label":"Falar com a equipe","intent":"needs_human","enabled":true}
      ]'::jsonb,
      'Seg-Sex 09:00-18:00. Sabado 09:00-13:00',
      'internal',
      true,
      4,
      60,
      60,
      'essencial',
      0,
      true,
      '5511940617713',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      now(),
      now()
    );
  ELSE
    UPDATE clinics
       SET name = 'BW odontologia',
           slug = 'bw-odontologia',
           specialty = 'Odontologia',
           city = COALESCE(city, 'Sao Paulo'),
           timezone = 'America/Sao_Paulo',
           conversation_experience = 'concierge',
           greeting_message = 'Ola! Sou a recepcionista virtual da BW odontologia. Posso ajudar com informacoes, valores da avaliacao e agendamentos. Como posso ajudar?',
           menu_items = '[
             {"number":1,"label":"Tratamentos odontologicos","intent":"procedures","enabled":true},
             {"number":2,"label":"Agendar avaliacao","intent":"book_appointment","enabled":true},
             {"number":3,"label":"Valores e formas de pagamento","intent":"price_inquiry","enabled":true},
             {"number":4,"label":"Endereco e horarios","intent":"location","enabled":true},
             {"number":5,"label":"Falar com a equipe","intent":"needs_human","enabled":true}
           ]'::jsonb,
           business_hours = 'Seg-Sex 09:00-18:00. Sabado 09:00-13:00',
           calendar_mode = 'internal',
           auto_reply_enabled = true,
           takeover_ttl_hours = 4,
           post_appointment_buffer_minutes = 60,
           default_appointment_duration_minutes = 60,
           monthly_revenue_brl = 0,
           is_test = true,
           receptionist_phone = '5511940617713',
           channel_provider = NULL,
           zapi_instance_id = NULL,
           zapi_token = NULL,
           zapi_client_token = NULL,
           meta_phone_number_id = NULL,
           meta_access_token = NULL,
           updated_at = now()
     WHERE id = v_target_clinic_id;
  END IF;

  INSERT INTO professionals (
    id,
    clinic_id,
    name,
    specialty,
    color,
    work_schedule,
    google_calendar_id,
    is_active,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    v_target_clinic_id,
    'Equipe BW',
    'Odontologia',
    '#2563EB',
    NULL,
    NULL,
    true,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM professionals WHERE clinic_id = v_target_clinic_id AND name = 'Equipe BW'
  );

  INSERT INTO treatments (
    id,
    clinic_id,
    name,
    duration_minutes,
    description,
    common_objections,
    requires_evaluation_first,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    v_target_clinic_id,
    seed.name,
    seed.duration_minutes,
    seed.description,
    '[]'::jsonb,
    seed.requires_evaluation_first,
    now(),
    now()
  FROM (
    VALUES
      ('Avaliacao odontologica', 60, 'Consulta inicial para entender o caso, orientar proximos passos e montar plano de tratamento.', false),
      ('Limpeza dental', 60, 'Profilaxia completa para remover tartaro e biofilme.', true),
      ('Clareamento dental', 60, 'Clareamento com avaliacao previa para indicar a melhor modalidade.', true),
      ('Implante dentario', 60, 'Reposicao de dente perdido com planejamento individualizado.', true),
      ('Lentes de resina composta', 90, 'Facetas em resina para transformar o sorriso com indicacao definida em avaliacao.', true)
  ) AS seed(name, duration_minutes, description, requires_evaluation_first)
  ON CONFLICT (clinic_id, name) DO UPDATE
     SET duration_minutes = EXCLUDED.duration_minutes,
         description = EXCLUDED.description,
         requires_evaluation_first = EXCLUDED.requires_evaluation_first,
         updated_at = now();

  UPDATE playbook_versions
     SET status = 'historical',
         updated_at = now()
   WHERE clinic_id = v_target_clinic_id
     AND status <> 'historical';

  INSERT INTO playbook_versions (
    id,
    clinic_id,
    name,
    status,
    specialty,
    procedure_description,
    tone_of_voice,
    differentials,
    commercial_policy,
    notes,
    objections,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_target_clinic_id,
    'BW odontologia - Atendimento inicial v1',
    'active',
    'Odontologia',
    'Avaliacao odontologica, limpeza dental, clareamento dental, implante dentario e lentes de resina composta.',
    'Acolhedor, consultivo e objetivo.',
    '["Atendimento odontologico acolhedor","Agenda organizada para avaliacao inicial","Comunicacao clara sobre proximos passos e formas de pagamento"]'::jsonb,
    'Nao informar valores fechados sem avaliacao. Explique que o plano e os valores dependem da avaliacao presencial. Quando o lead pedir agendamento, consulte a agenda interna e ofereca horarios reais.',
    'Voce e a recepcionista virtual da BW odontologia. Atenda com calma, clareza e objetividade. Entenda o interesse do paciente, explique que a avaliacao inicial define o plano ideal e ofereca agendamento quando houver interesse claro.',
    '[
      {"objection":"Estou so pesquisando","response":"Tudo bem. Posso te explicar com calma e, se fizer sentido, vemos um horario para avaliacao."},
      {"objection":"Quero saber valor","response":"O valor depende da avaliacao e do plano indicado. Posso te ajudar a marcar um horario para uma avaliacao inicial."}
    ]'::jsonb,
    now(),
    now()
  );

  IF v_source_clinic_id IS NULL THEN
    RAISE NOTICE 'BW odontologia criada, mas nenhuma Ximendes com Z-API foi encontrada para criar rotas QA.';
  ELSE
    INSERT INTO whatsapp_qa_routes (
      id,
      source_clinic_id,
      target_clinic_id,
      phone,
      label,
      enabled,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      v_source_clinic_id,
      v_target_clinic_id,
      seed.phone,
      seed.label,
      true,
      now(),
      now()
    FROM (
      VALUES
        ('5511940617713', 'Aline whatsapp clinica'),
        ('5511953628848', 'lead testes'),
        ('5511954368563', 'Gregorie lead testes')
    ) AS seed(phone, label)
    ON CONFLICT (source_clinic_id, phone) DO UPDATE
       SET target_clinic_id = EXCLUDED.target_clinic_id,
           label = EXCLUDED.label,
           enabled = true,
           updated_at = now();
  END IF;
END $$;
