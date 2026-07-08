# 📅 Importação Google Calendar — Vitalli

**Status**: ⏳ Aguardando Vitalli enviar arquivo  
**Bloqueador**: Crítico para sincronização de agenda  
**Timeline**: Quando arquivo chegar → T+7 go-live

---

## 📋 O que Vitalli Precisa Fazer

### Passo 1: Export Google Calendar

Gleice (ou admin de Vitalli) precisa:

1. **Ir para Google Calendar**: https://calendar.google.com
2. **Selecionar calendário** (Agenda da Clínica)
3. **Clique direito** → "Configurações"
4. **Aba "Integrar calendário"**
5. **Copiar URL no formato**:
   ```
   https://calendar.google.com/calendar/ical/[CALENDAR_ID]/public/basic.ics
   ```

### Passo 2: Enviar para você

**Arquivo**: `vitalli-calendar.ics` (formato iCal)  
**Enviar para**: seu email  
**Informações adicionais necessárias**:
- ✅ ID da clínica Vitalli (você já tem: `d24a584a-faac-4a46-9750-a718d0f8e686`)
- ✅ Timezone (São Paulo: `America/Sao_Paulo`)
- ✅ Duração padrão de consulta (ex: 60 minutos)

---

## 💾 Quando você receber o arquivo

### Script de Importação

```bash
# 1. Salvar arquivo recebido
mv ~/Downloads/vitalli-calendar.ics ./data/

# 2. Executar importação
ts-node scripts/import-google-calendar.ts \
  --clinic-id "d24a584a-faac-4a46-9750-a718d0f8e686" \
  --calendar-file "./data/vitalli-calendar.ics" \
  --timezone "America/Sao_Paulo" \
  --output "./reports/vitalli-import/resultado.json"

# 3. Validar resultado
cat ./reports/vitalli-import/resultado.json
```

---

## 📊 Formato Esperado

**Arquivo ICS** conterá:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc.//Google Calendar 7.0//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-TIMEZONE:America/Sao_Paulo
...
BEGIN:VEVENT
DTSTART:20260708T150000
DTEND:20260708T160000
SUMMARY:Consulta - Lentes
DESCRIPTION:Paciente João Silva
...
END:VEVENT
END:VCALENDAR
```

---

## ✅ Checklist Pós-Importação

Após receber e importar:

- [ ] Arquivo ICS recebido de Vitalli
- [ ] Executar script import-google-calendar.ts
- [ ] Validar: 0 erros no resultado.json
- [ ] Verificar: consultas aparecem no sistema
- [ ] Testar: booking funciona com horários reais
- [ ] Validar: caps aplicados (15/60)
- [ ] Pronto para T+7 go-live

---

## 📞 O que Fazer se...

### Arquivo não chegar (T+2)
1. Enviar email de lembrete para Vitalli
2. Oferecer call para orientar export
3. Fallback: criar agenda manualmente com Gleice

### Erro na importação
1. Verificar timezone
2. Validar formato ICS
3. Rodar: `npm run validate:calendar` 

### Consultas não sincronizam
1. Checar se googleCalendarId está preenchido no DB
2. Validar webhook de sincronização
3. Fazer sync manual: `npm run sync:calendar`

---

## 🎯 Checklist para Vitalli (enviar por WhatsApp/Email)

```
✅ Vitalli — AÇÃO NECESSÁRIA PARA GO-LIVE

Você precisa exportar o Google Calendar para sincronizarmos aqui.

PASSO A PASSO:
1. Abrir Google Calendar: https://calendar.google.com
2. Clicar direito na agenda de clínica → "Configurações"
3. Ir em "Integrar calendário"
4. Copiar URL (formato: https://calendar.google.com/calendar/ical/...)
5. Enviar para: [SEU EMAIL]

QUANDO: Hoje (08/07) se possível, máximo amanhã (09/07)
URGÊNCIA: Crítico para go-live em 17/07

Alguma dúvida?
```

---

## 📈 Impacto da Importação

Quando calendário estiver sincronizado:

✅ Lead pode:
- Ver horários reais (não fictícios)
- Confirmar agendamento
- Receber lembrete de consulta

✅ Você pode:
- Sincronizar 2-vias (sistema ↔ Google)
- Aplicar caps automáticos
- Validar disponibilidade real

✅ Gleice pode:
- Editar agenda no Google Calendar normalmente
- Sistema detecta mudanças automaticamente
- Sem duplicação manual

---

## 🚀 Timeline

```
T+0 (Hoje 08/07)
  └─ Deploy P0.1-P0.6 ✅
  └─ Solicitar calendário Vitalli

T+1 (09/07)
  └─ Receber arquivo ICS
  └─ Importar
  └─ Validar

T+7 (17/07)
  └─ Go-live com calendário sincronizado
```

---

*Documentado em: 08/07/2026 18:53 São Paulo*  
*Bloqueador: Externa (Vitalli precisa enviar arquivo)*  
*Criticidade: Alta (necessário para agendamento funcionar)*
