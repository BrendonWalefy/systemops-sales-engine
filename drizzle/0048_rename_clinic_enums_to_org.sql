-- ADR-001 Layer 3: renomear enums internos de clinic_* para org_*
-- Também renomeia o valor 'clinica' do plano para 'avancado' (neutro para multi-segmento)
-- e 'clinic_admin' para 'org_admin' no member_role.
-- PostgreSQL suporta RENAME VALUE desde v10 e RENAME TO em tipos desde sempre.
-- Operações são transacionais e instantâneas (sem cópia de dados).

-- 1. Renomear valor no member_role
ALTER TYPE member_role RENAME VALUE 'clinic_admin' TO 'org_admin';

-- 2. Renomear valor no plano (clinica → avancado)
ALTER TYPE clinic_plan RENAME VALUE 'clinica' TO 'avancado';

-- 3. Renomear o tipo do plano
ALTER TYPE clinic_plan RENAME TO org_plan;

-- 4. Renomear o tipo de status operacional
ALTER TYPE clinic_operational_status RENAME TO org_operational_status;
