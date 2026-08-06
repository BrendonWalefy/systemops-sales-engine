import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, "systemops-current-architecture.drawio");

const COLORS = {
  navy: "#172B4D",
  blue: "#2563EB",
  blueLight: "#EAF2FF",
  teal: "#0F766E",
  tealLight: "#E6FFFB",
  green: "#16A34A",
  greenLight: "#ECFDF3",
  orange: "#EA580C",
  orangeLight: "#FFF3E8",
  purple: "#7C3AED",
  purpleLight: "#F3E8FF",
  red: "#DC2626",
  redLight: "#FEF2F2",
  yellow: "#CA8A04",
  yellowLight: "#FEFCE8",
  gray: "#475569",
  grayLight: "#F8FAFC",
  line: "#94A3B8",
  white: "#FFFFFF",
  black: "#111827",
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function label(title, subtitle = "", badge = "") {
  const badgeHtml = badge
    ? `<span style="display:inline-block;padding:2px 6px;border-radius:10px;background:#E2E8F0;color:#334155;font-size:9px;font-weight:700;">${badge}</span><br>`
    : "";
  return `<div style="line-height:1.25;text-align:center;">${badgeHtml}<b style="font-size:13px;color:#0F172A;">${title}</b>${subtitle ? `<br><span style="font-size:10px;color:#475569;">${subtitle}</span>` : ""}</div>`;
}

function titleLabel(kicker, title, subtitle) {
  return `<div style="text-align:left;line-height:1.2;"><span style="font-size:11px;letter-spacing:1px;color:#2563EB;font-weight:700;">${kicker}</span><br><b style="font-size:25px;color:#172B4D;">${title}</b><br><span style="font-size:11px;color:#64748B;">${subtitle}</span></div>`;
}

const STYLES = {
  title: "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;overflow=hidden;",
  section: `rounded=1;arcSize=10;html=1;whiteSpace=wrap;strokeWidth=2;strokeColor=${COLORS.line};fillColor=${COLORS.grayLight};verticalAlign=top;align=left;spacingTop=10;spacingLeft=12;fontColor=${COLORS.navy};fontStyle=1;fontSize=14;dashed=1;dashPattern=7 5;`,
  sectionBlue: `rounded=1;arcSize=10;html=1;whiteSpace=wrap;strokeWidth=2;strokeColor=${COLORS.blue};fillColor=#F8FBFF;verticalAlign=top;align=left;spacingTop=10;spacingLeft=12;fontColor=${COLORS.navy};fontStyle=1;fontSize=14;dashed=1;dashPattern=7 5;`,
  sectionOrange: `rounded=1;arcSize=10;html=1;whiteSpace=wrap;strokeWidth=2;strokeColor=${COLORS.orange};fillColor=#FFFBF7;verticalAlign=top;align=left;spacingTop=10;spacingLeft=12;fontColor=${COLORS.navy};fontStyle=1;fontSize=14;dashed=1;dashPattern=7 5;`,
  card: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.line};fillColor=${COLORS.white};shadow=0;verticalAlign=middle;align=center;spacing=8;`,
  blue: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.blue};fillColor=${COLORS.blueLight};verticalAlign=middle;align=center;spacing=8;`,
  teal: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.teal};fillColor=${COLORS.tealLight};verticalAlign=middle;align=center;spacing=8;`,
  green: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.green};fillColor=${COLORS.greenLight};verticalAlign=middle;align=center;spacing=8;`,
  orange: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.orange};fillColor=${COLORS.orangeLight};verticalAlign=middle;align=center;spacing=8;`,
  purple: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.purple};fillColor=${COLORS.purpleLight};verticalAlign=middle;align=center;spacing=8;`,
  red: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.red};fillColor=${COLORS.redLight};verticalAlign=middle;align=center;spacing=8;`,
  yellow: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.yellow};fillColor=${COLORS.yellowLight};verticalAlign=middle;align=center;spacing=8;`,
  dark: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.black};fillColor=#EEF2F7;verticalAlign=middle;align=center;spacing=8;`,
  actor: `rounded=1;arcSize=12;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.gray};fillColor=${COLORS.white};fontColor=${COLORS.navy};fontSize=12;verticalAlign=middle;align=center;spacing=8;`,
  datastore: `shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=14;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.blue};fillColor=${COLORS.blueLight};verticalAlign=middle;align=center;spacingTop=8;`,
  queue: `shape=process;html=1;whiteSpace=wrap;strokeWidth=1.5;strokeColor=${COLORS.purple};fillColor=${COLORS.purpleLight};verticalAlign=middle;align=center;spacing=8;`,
  note: `shape=note;html=1;whiteSpace=wrap;strokeWidth=1;strokeColor=#CBD5E1;fillColor=#FFFDF5;size=18;verticalAlign=top;align=left;spacing=10;fontSize=10;fontColor=#475569;`,
  step: `ellipse;html=1;whiteSpace=wrap;aspect=fixed;strokeWidth=2;strokeColor=${COLORS.blue};fillColor=${COLORS.blue};fontColor=${COLORS.white};fontStyle=1;fontSize=13;`,
  text: "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;overflow=hidden;fontColor=#475569;fontSize=11;",
  edge: `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=1.6;strokeColor=${COLORS.gray};endArrow=block;endFill=1;fontSize=10;fontColor=${COLORS.gray};labelBackgroundColor=${COLORS.white};`,
  edgeBlue: `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=${COLORS.blue};endArrow=block;endFill=1;fontSize=10;fontColor=${COLORS.blue};labelBackgroundColor=${COLORS.white};`,
  edgeGreen: `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=1.8;strokeColor=${COLORS.green};endArrow=block;endFill=1;fontSize=10;fontColor=${COLORS.green};labelBackgroundColor=${COLORS.white};`,
  edgeDashed: `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=1.4;strokeColor=${COLORS.line};dashed=1;dashPattern=6 4;endArrow=open;endFill=0;fontSize=10;fontColor=${COLORS.gray};labelBackgroundColor=${COLORS.white};`,
};

function graph(pageWidth = 1920, pageHeight = 1200) {
  const containers = [];
  const edges = [];
  const vertices = [];
  let seq = 2;

  const addVertex = (id, value, x, y, width, height, style = STYLES.card, layer = "vertices") => {
    const cell = `<mxCell id="${escapeXml(id)}" value="${escapeXml(value)}" style="${escapeXml(style)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`;
    (layer === "containers" ? containers : vertices).push(cell);
    seq += 1;
    return id;
  };

  const addEdge = (source, target, value = "", style = STYLES.edge, points = []) => {
    const pointXml = points.length
      ? `<Array as="points">${points.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>`
      : "";
    edges.push(`<mxCell id="e${seq++}" value="${escapeXml(value)}" style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(source)}" target="${escapeXml(target)}"><mxGeometry relative="1" as="geometry">${pointXml}</mxGeometry></mxCell>`);
  };

  const toXml = () => `<mxGraphModel dx="1920" dy="1200" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${containers.join("")}${edges.join("")}${vertices.join("")}</root></mxGraphModel>`;

  return { addVertex, addEdge, toXml };
}

function page1() {
  const g = graph(1920, 1200);
  g.addVertex("p1-title", titleLabel("SYSTEMOPS CORE • ESTADO ATUAL", "01 — Arquitetura técnica e integrações", "Monólito modular Next.js em Vercel • pipeline híbrido assíncrono • multi-tenant no Neon/PostgreSQL • atualizado em 05/08/2026"), 40, 25, 1840, 75, STYLES.title);

  g.addVertex("p1-vercel", "PLATAFORMA SYSTEMOPS • VERCEL", 260, 120, 1290, 990, STYLES.sectionBlue, "containers");
  g.addVertex("p1-runtime", "RUNTIME NEXT.JS 16 / TYPESCRIPT 5.8 / REACT 19", 300, 155, 1210, 190, STYLES.section, "containers");
  g.addVertex("p1-async", "PIPELINE ASSÍNCRONO DURÁVEL", 300, 370, 1210, 330, STYLES.sectionOrange, "containers");
  g.addVertex("p1-data", "PERSISTÊNCIA MULTI-TENANT", 300, 730, 1210, 330, STYLES.section, "containers");
  g.addVertex("p1-ext", "CAPABILITIES EXTERNAS", 1585, 120, 295, 990, STYLES.section, "containers");
  g.addVertex("p1-channel-sec", "CANAL EXTERNO", 10, 400, 220, 350, STYLES.section, "containers");

  g.addVertex("p1-owner", label("Owner SystemOps", "opera clínicas e qualidade", "USER"), 30, 150, 180, 70, STYLES.actor);
  g.addVertex("p1-team", label("Equipe da clínica", "browser / PWA", "USER"), 30, 275, 180, 70, STYLES.actor);
  g.addVertex("p1-lead", label("Lead / paciente", "WhatsApp", "USER"), 30, 440, 180, 70, STYLES.actor);

  g.addVertex("p1-ui", label("App Router / SSR", "Home • Inbox • Agenda • Pipeline • Campanhas • Owner", "NEXT.JS"), 330, 205, 330, 100, STYLES.dark);
  g.addVertex("p1-api", label("Route Handlers + Server Actions", "sessão, tenancy, APIs finas e CRUD", "APP"), 700, 205, 330, 100, STYLES.blue);
  g.addVertex("p1-cron", label("Vercel Cron", "workers, métricas, follow-ups, lembretes e saúde", "CRON"), 1070, 205, 200, 100, STYLES.orange);
  g.addVertex("p1-obs", label("Observabilidade", "logs estruturados • Decision Trace • Sentry", "OPS"), 1310, 205, 160, 100, STYLES.purple);

  g.addVertex("p1-ingress", label("Webhook ingress", "/api/whatsapp/zapi • /webhook Meta", "HTTP"), 330, 440, 185, 90, STYLES.green);
  g.addVertex("p1-inbound", label("inbound_events", "payload bruto + idempotência", "INBOX"), 550, 440, 175, 90, STYLES.queue);
  g.addVertex("p1-processq", label("jobs", "message.process", "QUEUE"), 760, 440, 150, 90, STYLES.queue);
  g.addVertex("p1-worker", label("message-worker", "ProcessMessageJobHandler", "WORKER"), 945, 440, 180, 90, STYLES.orange);
  g.addVertex("p1-core", label("Core determinístico", "Orchestrator • State Machine • BookingService", "CORE"), 1160, 420, 220, 130, STYLES.blue);

  g.addVertex("p1-outbox", label("outbound_messages", "ordem + dedupe + retry", "OUTBOX"), 1160, 580, 220, 85, STYLES.queue);
  g.addVertex("p1-sendq", label("jobs", "message.send", "QUEUE"), 945, 580, 180, 85, STYLES.queue);
  g.addVertex("p1-sender", label("sender-worker", "Safety Gate + entrega", "WORKER"), 730, 580, 180, 85, STYLES.orange);
  g.addVertex("p1-channel", label("Channel adapters", "Z-API principal • Meta compat.", "PORT"), 500, 580, 190, 85, STYLES.green);

  g.addVertex("p1-db", label("Neon PostgreSQL", "Drizzle ORM / Drizzle Kit", "DATABASE"), 335, 800, 260, 185, STYLES.datastore);
  g.addVertex("p1-runtime-data", label("Jornada", "clinics • leads • conversations • messages • conversation_states"), 635, 790, 240, 100, STYLES.blue);
  g.addVertex("p1-config-data", label("Configuração", "playbook_versions • treatments • pipelineSteps • clinic_modules • professionals"), 905, 790, 260, 100, STYLES.teal);
  g.addVertex("p1-agenda-data", label("Agenda e conteúdo", "appointments • calendar_blocks • media_assets • price_campaigns"), 1195, 790, 260, 100, STYLES.green);
  g.addVertex("p1-ops-data", label("Operação durável", "inbound_events • jobs • outbound_messages • follow_ups • traces"), 635, 925, 350, 95, STYLES.purple);
  g.addVertex("p1-analytics-data", label("Métricas e campanhas", "daily_metrics • lead_outcomes • reactivation_campaigns / targets • health snapshots"), 1015, 925, 440, 95, STYLES.yellow);

  g.addVertex("p1-zapi", label("Z-API", "canal principal por clínica", "WHATSAPP"), 30, 540, 180, 75, STYLES.green);
  g.addVertex("p1-meta", label("Meta Cloud API", "compatibilidade + HMAC", "WHATSAPP"), 30, 645, 180, 75, STYLES.green);
  g.addVertex("p1-openai", label("OpenAI", "classificação • composição • Whisper • TTS", "AI"), 1615, 180, 235, 95, STYLES.teal);
  g.addVertex("p1-tts", label("TTS Providers", "OpenAI • Google Neural2 • ElevenLabs • Fal/Kokoro", "VOICE"), 1615, 315, 235, 95, STYLES.purple);
  g.addVertex("p1-gcal", label("Google Calendar", "gateway opt-in + watch", "CALENDAR"), 1615, 450, 235, 85, STYLES.blue);
  g.addVertex("p1-blob", label("Vercel Blob", "mídia, uploads e áudio TTS", "STORAGE"), 1615, 575, 235, 85, STYLES.dark);
  g.addVertex("p1-notify", label("Resend + Web Push", "digest, alertas e handoff", "NOTIFY"), 1615, 700, 235, 85, STYLES.red);
  g.addVertex("p1-sentry", label("Sentry", "erros e contexto sanitizado", "OBSERVE"), 1615, 825, 235, 85, STYLES.purple);

  g.addEdge("p1-owner", "p1-ui", "HTTPS");
  g.addEdge("p1-team", "p1-ui", "HTTPS / sessão");
  g.addEdge("p1-ui", "p1-api", "SSR + actions", STYLES.edgeBlue);
  g.addEdge("p1-api", "p1-db", "Drizzle", STYLES.edgeDashed, [[680, 330], [680, 760]]);
  g.addEdge("p1-cron", "p1-worker", "a cada minuto", STYLES.edgeBlue);
  g.addEdge("p1-cron", "p1-sender", "a cada minuto", STYLES.edgeBlue, [[1020, 340], [1020, 560]]);
  g.addEdge("p1-lead", "p1-zapi", "mensagem", STYLES.edgeGreen);
  g.addEdge("p1-zapi", "p1-ingress", "webhook", STYLES.edgeGreen);
  g.addEdge("p1-meta", "p1-ingress", "webhook compat.", STYLES.edgeDashed);
  g.addEdge("p1-ingress", "p1-inbound", "persiste");
  g.addEdge("p1-inbound", "p1-processq", "enfileira");
  g.addEdge("p1-processq", "p1-worker", "claim + lease");
  g.addEdge("p1-worker", "p1-core", "turno", STYLES.edgeBlue);
  g.addEdge("p1-core", "p1-outbox", "intenção de envio", STYLES.edgeBlue);
  g.addEdge("p1-outbox", "p1-sendq", "job");
  g.addEdge("p1-sendq", "p1-sender", "claim ordenado");
  g.addEdge("p1-sender", "p1-channel", "texto / áudio / mídia", STYLES.edgeBlue);
  g.addEdge("p1-channel", "p1-zapi", "API de envio", STYLES.edgeGreen, [[470, 620], [245, 620], [245, 575]]);
  g.addEdge("p1-core", "p1-db", "estado + config", STYLES.edgeDashed, [[1140, 555], [1140, 710], [470, 710]]);
  g.addEdge("p1-core", "p1-openai", "LLM / Whisper", STYLES.edgeDashed);
  g.addEdge("p1-core", "p1-gcal", "CalendarGateway", STYLES.edgeDashed);
  g.addEdge("p1-sender", "p1-tts", "síntese", STYLES.edgeDashed, [[920, 625], [1545, 625], [1545, 365]]);
  g.addEdge("p1-sender", "p1-blob", "mídia", STYLES.edgeDashed, [[930, 650], [1545, 650], [1545, 620]]);
  g.addEdge("p1-obs", "p1-sentry", "erros", STYLES.edgeDashed, [[1490, 250], [1565, 250], [1565, 870]]);
  g.addEdge("p1-cron", "p1-notify", "digests / alertas", STYLES.edgeDashed, [[1290, 250], [1545, 250], [1545, 745]]);

  g.addVertex("p1-note", `<b>Leitura rápida</b><br>• O Postgres é banco, inbox, fila e outbox.<br>• Tenant é resolvido antes de toda leitura/escrita.<br>• Agenda interna é padrão; Google Calendar é opt-in.<br>• Respostas ao lead passam pela outbox; alertas internos de WhatsApp ainda têm caminho operacional separado.`, 20, 790, 210, 250, STYLES.note);
  return g.toXml();
}

function page2() {
  const g = graph(1920, 1300);
  g.addVertex("p2-title", titleLabel("RUNTIME CONVERSACIONAL", "02 — Microintegrações: conversa, LLMs e pipeline", "O LLM entende e verbaliza; o sistema decide • fluxo principal de uma mensagem do WhatsApp até a entrega"), 40, 25, 1840, 75, STYLES.title);

  g.addVertex("p2-ingress-sec", "1 • ENTRADA DURÁVEL", 45, 125, 1830, 180, STYLES.sectionGreen ?? STYLES.section, "containers");
  g.addVertex("p2-orch-sec", "2 • TURNO EXCLUSIVO DA CONVERSA", 255, 345, 1410, 700, STYLES.sectionBlue, "containers");
  g.addVertex("p2-deps-sec", "DEPENDÊNCIAS POR PORTS / GATEWAYS", 45, 1080, 1830, 160, STYLES.sectionOrange, "containers");

  const top = [
    ["p2-wa", "WhatsApp", "Z-API / Meta", "WHATSAPP", 75, STYLES.green],
    ["p2-hook", "Webhook fino", "autentica + tenant", "INGRESS", 315, STYLES.green],
    ["p2-event", "inbound_events", "raw + dedupe", "INBOX", 555, STYLES.queue],
    ["p2-job", "jobs", "message.process", "QUEUE", 795, STYLES.queue],
    ["p2-proc", "ProcessMessageJob", "normaliza + policy + áudio", "WORKER", 1035, STYLES.orange],
    ["p2-lease", "Turn lease", "1 worker por conversa", "LOCK", 1275, STYLES.yellow],
    ["p2-handle", "Orchestrator.handle", "turnId correlacionado", "CORE", 1515, STYLES.blue],
  ];
  for (const [id, t, s, b, x, style] of top) g.addVertex(id, label(t, s, b), x, 185, 185, 80, style);
  for (let i = 0; i < top.length - 1; i++) g.addEdge(top[i][0], top[i + 1][0], i === 0 ? "webhook" : "", STYLES.edgeBlue);

  const steps = [
    ["p2-s1", "1", 300, 395], ["p2-s2", "2", 700, 395], ["p2-s3", "3", 1100, 395], ["p2-s4", "4", 1420, 395],
    ["p2-s5", "5", 300, 610], ["p2-s6", "6", 700, 610], ["p2-s7", "7", 1100, 610], ["p2-s8", "8", 1420, 610],
    ["p2-s9", "9", 300, 825], ["p2-s10", "10", 700, 825], ["p2-s11", "11", 1100, 825], ["p2-s12", "12", 1420, 825],
  ];
  for (const [id, n, x, y] of steps) g.addVertex(id, n, x, y, 32, 32, STYLES.step);

  g.addVertex("p2-register", label("RegisterIncomingMessage", "resolve lead + conversa; grava histórico", "USE CASE"), 345, 385, 285, 95, STYLES.blue);
  g.addVertex("p2-state", label("ConversationStateMachine", "active ↔ ai_paused • stale → active", "STATE"), 745, 385, 285, 95, STYLES.yellow);
  g.addVertex("p2-context", label("PromptContextBuilder", "histórico único + config editorial", "CONTEXT"), 1145, 385, 285, 95, STYLES.teal);
  g.addVertex("p2-intent", label("IntentClassifier", "JSON estruturado • intenção + confiança", "LLM"), 1460, 385, 185, 95, STYLES.purple);

  g.addVertex("p2-router", label("Roteador determinístico por intenção", "valida invariantes e escolhe ações reais; o modelo não reserva agenda, não muda tenant e não decide handoff final", "SYSTEM DECIDES"), 345, 600, 285, 115, STYLES.blue);
  g.addVertex("p2-pipeline", label("Pipeline do tratamento", "pipelineSteps • Q&A • foto • mídia • limite de turnos", "PIPELINE"), 745, 600, 285, 115, STYLES.teal);
  g.addVertex("p2-domain", label("Ações de domínio", "BookingService • lead status • follow-up • handoff", "CORE"), 1145, 600, 285, 115, STYLES.green);
  g.addVertex("p2-result", label("Resultado concreto", "slots reais, reserva, pausa, conteúdo e próxima etapa", "ACTION RESULT"), 1460, 600, 185, 115, STYLES.yellow);

  g.addVertex("p2-compose", label("ResponseComposer", "verbaliza apenas o resultado permitido", "LLM"), 345, 815, 285, 100, STYLES.purple);
  g.addVertex("p2-media", label("PipelineMediaRouter", "ContentBlock → texto / vídeo / imagem / áudio", "CONTENT"), 745, 815, 285, 100, STYLES.teal);
  g.addVertex("p2-outbound", label("Outbox + avanço de estado", "outbound_messages + job message.send + revisão idempotente", "COMMIT"), 1145, 815, 285, 100, STYLES.queue);
  g.addVertex("p2-delivery", label("Sender + Safety Gate", "ordem • opt-out • quiet hours • caps • retry", "DELIVERY"), 1460, 815, 185, 100, STYLES.orange);

  g.addVertex("p2-outcome", label("Persistência do turno", "messages • leads • conversation_states • follow_ups • decision_traces", "POSTGRES"), 500, 950, 900, 65, STYLES.datastore);

  g.addEdge("p2-handle", "p2-register", "inicia", STYLES.edgeBlue, [[1730, 320], [230, 320], [230, 430]]);
  g.addEdge("p2-register", "p2-state", "");
  g.addEdge("p2-state", "p2-context", "");
  g.addEdge("p2-context", "p2-intent", "prompt");
  g.addEdge("p2-intent", "p2-router", "intent", STYLES.edgeBlue, [[1670, 500], [1670, 560], [330, 560]]);
  g.addEdge("p2-router", "p2-pipeline", "quando aplicável");
  g.addEdge("p2-pipeline", "p2-domain", "ação");
  g.addEdge("p2-domain", "p2-result", "resultado");
  g.addEdge("p2-result", "p2-compose", "dados permitidos", STYLES.edgeBlue, [[1670, 735], [1670, 775], [330, 775]]);
  g.addEdge("p2-compose", "p2-media", "ResponsePart");
  g.addEdge("p2-media", "p2-outbound", "conteúdo final");
  g.addEdge("p2-outbound", "p2-delivery", "message.send");
  g.addEdge("p2-register", "p2-outcome", "grava", STYLES.edgeDashed);
  g.addEdge("p2-state", "p2-outcome", "estado", STYLES.edgeDashed);
  g.addEdge("p2-domain", "p2-outcome", "efeitos", STYLES.edgeDashed);
  g.addEdge("p2-outbound", "p2-outcome", "outbox", STYLES.edgeDashed);

  g.addVertex("p2-cfg", label("Config por clínica", "clinics • modules • active playbook • treatments", "NEON"), 75, 1120, 300, 85, STYLES.datastore);
  g.addVertex("p2-ai", label("OpenAI", "IntentClassifier • ResponseComposer • Whisper", "AI"), 420, 1120, 300, 85, STYLES.teal);
  g.addVertex("p2-cal", label("CalendarGateway", "agenda interna ou Google Calendar opt-in", "CALENDAR"), 765, 1120, 300, 85, STYLES.blue);
  g.addVertex("p2-storage", label("Vercel Blob + TTS", "mídia de pipeline, uploads e voz", "MEDIA"), 1110, 1120, 300, 85, STYLES.purple);
  g.addVertex("p2-channel-out", label("Channel adapter", "Z-API principal / Meta compatibilidade", "WHATSAPP"), 1455, 1120, 300, 85, STYLES.green);
  g.addEdge("p2-cfg", "p2-context", "runtime config", STYLES.edgeDashed);
  g.addEdge("p2-ai", "p2-intent", "classifica", STYLES.edgeDashed);
  g.addEdge("p2-ai", "p2-compose", "redige", STYLES.edgeDashed);
  g.addEdge("p2-cal", "p2-domain", "slots / booking", STYLES.edgeDashed);
  g.addEdge("p2-storage", "p2-media", "assets", STYLES.edgeDashed);
  g.addEdge("p2-delivery", "p2-channel-out", "envia", STYLES.edgeGreen);

  g.addVertex("p2-rule", `<b>Invariante</b><br>Conteúdo editorial vem do playbook ativo; regras operacionais vêm de código e configuração estruturada. O mesmo fato não deve ser duplicado em prompt, orquestrador e banco.`, 1685, 385, 165, 530, STYLES.note);
  return g.toXml();
}

function page3() {
  const g = graph(1920, 1320);
  g.addVertex("p3-title", titleLabel("PRODUTO E DADOS", "03 — Features, Home e fontes de verdade", "Como cada tela é abastecida e quais serviços/tabelas executam as ações"), 40, 25, 1840, 75, STYLES.title);

  g.addVertex("p3-home-sec", "HOME / COMMAND CENTER — DATA LINEAGE", 45, 120, 1830, 520, STYLES.sectionBlue, "containers");
  g.addVertex("p3-home-db", "FONTES NO NEON / DRIZZLE", 75, 170, 430, 405, STYLES.section, "containers");
  g.addVertex("p3-home-server", "SERVER COMPONENT", 570, 170, 500, 405, STYLES.sectionOrange, "containers");
  g.addVertex("p3-home-ui", "O QUE A HOME ENTREGA", 1135, 170, 700, 405, STYLES.section, "containers");

  const sources = [
    ["p3-leads", "leads + conversations", "status, temperatura, resumo, atenção", 100, 225, STYLES.blue],
    ["p3-msgs", "messages", "última mensagem, volume, fora do horário", 295, 225, STYLES.blue],
    ["p3-appts", "appointments", "agenda de hoje, receita potencial/realizada", 100, 335, STYLES.green],
    ["p3-catalog", "treatments + price_campaigns", "preço efetivo e receita prevista", 295, 335, STYLES.teal],
    ["p3-org", "organizations + professionals", "clínica, operação, meta e permissões", 100, 445, STYLES.orange],
    ["p3-health", "channel_health_snapshots", "score atual do canal", 295, 445, STYLES.yellow],
  ];
  for (const [id, t, s, x, y, style] of sources) g.addVertex(id, label(t, s), x, y, 175, 85, style);
  g.addVertex("p3-fetch", label("fetchDashboardData(period)", "tenant da sessão • períodos 1d / 7d / 30d • queries paralelas", "SERVER"), 620, 230, 400, 95, STYLES.orange);
  g.addVertex("p3-calc", label("Cálculos determinísticos", "buildPeriodFunnel • buildFlowSeries • preço efetivo • RBAC financeiro", "CODE"), 620, 360, 400, 105, STYLES.blue);
  g.addVertex("p3-render", label("DashboardCommandCenter", "SSR + componentes responsivos", "REACT"), 620, 495, 400, 60, STYLES.dark);

  g.addVertex("p3-kpi", label("KPIs operacionais", "leads • quentes • agendados • atenção • mensagens"), 1165, 225, 195, 85, STYLES.blue);
  g.addVertex("p3-funnel", label("Funil do período", "total → quentes/mornos → em conversa → agendados → ganhos"), 1390, 225, 195, 85, STYLES.purple);
  g.addVertex("p3-flow", label("Fluxo de entrada", "novos leads por dia + comparação anterior"), 1615, 225, 190, 85, STYLES.teal);
  g.addVertex("p3-agenda", label("Agenda", "hoje + próximos compromissos"), 1165, 350, 195, 85, STYLES.green);
  g.addVertex("p3-revenue", label("Receita e ROI", "potencial • realizada • por tratamento • acesso por papel"), 1390, 350, 195, 85, STYLES.yellow);
  g.addVertex("p3-actions", label("Filas acionáveis", "quentes • recuperação • atenção humana • insights"), 1615, 350, 190, 85, STYLES.red);
  g.addVertex("p3-health-ui", label("Saúde operacional", "auto-reply • safety mode • channel health"), 1280, 475, 230, 70, STYLES.orange);
  g.addVertex("p3-nav", label("Navegação contextual", "cards levam a Inbox, Agenda e Recuperação"), 1540, 475, 230, 70, STYLES.dark);

  for (const [id] of sources) g.addEdge(id, "p3-fetch", "", STYLES.edgeDashed);
  g.addEdge("p3-fetch", "p3-calc", "dataset");
  g.addEdge("p3-calc", "p3-render", "DashboardData", STYLES.edgeBlue);
  for (const id of ["p3-kpi", "p3-funnel", "p3-flow", "p3-agenda", "p3-revenue", "p3-actions", "p3-health-ui", "p3-nav"]) g.addEdge("p3-render", id, "", STYLES.edgeDashed);

  g.addVertex("p3-features", "MAPA DAS DEMAIS FEATURES", 45, 680, 1830, 580, STYLES.section, "containers");
  g.addVertex("p3-h1", "SUPERFÍCIE", 85, 720, 250, 45, STYLES.dark);
  g.addVertex("p3-h2", "SERVIÇO / REGRA", 395, 720, 500, 45, STYLES.dark);
  g.addVertex("p3-h3", "FONTE DE VERDADE", 955, 720, 560, 45, STYLES.dark);
  g.addVertex("p3-h4", "RESULTADO / INTEGRAÇÃO", 1575, 720, 250, 45, STYLES.dark);

  const rows = [
    ["inbox", "Inbox + handoff", "Inbox snapshot • manual send • ConversationStateMachine", "leads • conversations • messages • conversation_states • outbound_messages", "IA ativa / pausada • chat • Web Push", STYLES.red],
    ["agenda2", "Agenda", "BookingService • SlotReservationService • CalendarGateway • ClinicTimezone", "appointments • calendar_blocks • professionals • treatments", "agenda interna ou Google Calendar", STYLES.green],
    ["pipe", "Pipeline", "ConversationOrchestrator • PipelineMediaRouter • guided actions", "treatments.pipelineSteps • media_assets • playbook_versions", "vídeo → Q&A → foto → slots", STYLES.teal],
    ["settings", "Configurações", "publicação atômica • lint • module gates • autosave", "clinics • clinic_modules • playbook_versions • treatments • professionals", "runtime configurado sem hardcode", STYLES.blue],
    ["owner2", "Owner / operação", "Blueprint • saúde • custos • qualidade • onboarding", "organizations • memberships • usage_costs • daily_metrics • snapshots", "go-live • alertas • margem • Sentry/Resend", STYLES.purple],
  ];
  rows.forEach(([id, surface, service, source, result, style], index) => {
    const y = 790 + index * 88;
    g.addVertex(`p3-${id}-a`, label(surface, "rota /app ou /owner"), 85, y, 250, 65, style);
    g.addVertex(`p3-${id}-b`, label(service, ""), 395, y, 500, 65, STYLES.card);
    g.addVertex(`p3-${id}-c`, label(source, ""), 955, y, 560, 65, STYLES.datastore);
    g.addVertex(`p3-${id}-d`, label(result, ""), 1575, y, 250, 65, STYLES.card);
    g.addEdge(`p3-${id}-a`, `p3-${id}-b`, "chama");
    g.addEdge(`p3-${id}-b`, `p3-${id}-c`, "lê/grava", STYLES.edgeDashed);
    g.addEdge(`p3-${id}-b`, `p3-${id}-d`, "entrega", STYLES.edgeBlue);
  });

  return g.toXml();
}

function page4() {
  const g = graph(1920, 1380);
  g.addVertex("p4-title", titleLabel("CRESCIMENTO E AUTOMAÇÕES", "04 — Campanhas, ofertas, follow-ups e lembretes", "Preço promocional e campanha de reativação são conceitos diferentes, conectados por referências explícitas"), 40, 25, 1840, 75, STYLES.title);

  g.addVertex("p4-price-sec", "A • OFERTAS / CAMPANHAS DE PREÇO", 45, 125, 1830, 250, STYLES.sectionBlue, "containers");
  g.addVertex("p4-react-sec", "B • CAMPANHAS DE REATIVAÇÃO — CRIAÇÃO, REVISÃO E DISPARO", 45, 405, 1830, 545, STYLES.sectionOrange, "containers");
  g.addVertex("p4-auto-sec", "C • AUTOMAÇÕES RECORRENTES", 45, 980, 1830, 340, STYLES.section, "containers");

  g.addVertex("p4-treat", label("Tratamentos", "preço de lista + duração", "treatments"), 85, 200, 220, 95, STYLES.teal);
  g.addVertex("p4-price", label("Oferta configurada", "valor/faixa • vigência • ativa", "price_campaigns"), 375, 200, 240, 95, STYLES.yellow);
  g.addVertex("p4-resolve", label("resolveEffectivePrice", "promoção vigente sobrepõe lista", "CODE"), 685, 200, 250, 95, STYLES.blue);
  g.addVertex("p4-chat", label("Conversa / cotação", "valor injetado no runtime", "ORCHESTRATOR"), 1005, 180, 230, 70, STYLES.purple);
  g.addVertex("p4-dash", label("Home / receita prevista", "mesma regra de preço efetivo", "DASHBOARD"), 1005, 275, 230, 70, STYLES.blue);
  g.addVertex("p4-book", label("Agendamento", "valueCents + campaignId", "APPOINTMENT"), 1305, 180, 230, 70, STYLES.green);
  g.addVertex("p4-reactref", label("Reativação", "oferta opcional por referência", "CAMPAIGN"), 1305, 275, 230, 70, STYLES.orange);
  g.addVertex("p4-rule-price", `<b>Único dono do valor promocional</b><br>O texto da IA, a Home e o booking consomem a mesma resolução. O preço não deve ser copiado para prompt, notes ou mensagem fixa.`, 1600, 180, 220, 165, STYLES.note);
  g.addEdge("p4-treat", "p4-price", "1:N");
  g.addEdge("p4-price", "p4-resolve", "vigência");
  for (const id of ["p4-chat", "p4-dash", "p4-book", "p4-reactref"]) g.addEdge("p4-resolve", id, "", STYLES.edgeDashed);

  const campaignFlow = [
    ["p4-segment", "1", "Segmentar audiência", "janela • motivo • silêncio • status", 80, STYLES.blue],
    ["p4-preview", "2", "Preview + congelamento", "resolveAudience • máximo 500", 330, STYLES.blue],
    ["p4-campaign", "3", "Criar campanha", "reactivation_campaigns + targets", 580, STYLES.orange],
    ["p4-drafts", "4", "Gerar rascunhos", "ReactivationMessageComposer por lead", 830, STYLES.purple],
    ["p4-review", "5", "Revisão humana", "editar • aprovar/rejeitar alvo", 1080, STYLES.yellow],
    ["p4-approve", "6", "Aprovar campanha", "approvedAt obrigatório", 1330, STYLES.green],
    ["p4-dispatch", "7", "Dispatch", "cap diário + kill switches", 1580, STYLES.orange],
  ];
  for (const [id, n, t, s, x, style] of campaignFlow) {
    g.addVertex(`${id}-n`, n, x, 480, 30, 30, STYLES.step);
    g.addVertex(id, label(t, s), x, 520, 205, 90, style);
  }
  for (let i = 0; i < campaignFlow.length - 1; i++) g.addEdge(campaignFlow[i][0], campaignFlow[i + 1][0], "", STYLES.edgeBlue);

  g.addVertex("p4-audience-data", label("Seleção comercial", "leads • conversations • lead_outcomes • appointments • outbound history", "POSTGRES"), 100, 665, 330, 100, STYLES.datastore);
  g.addVertex("p4-outbox", label("Outbox compartilhada", "outbound_messages(category=campaign) + jobs(message.send)", "DURABLE"), 530, 665, 350, 100, STYLES.queue);
  g.addVertex("p4-safety", label("Safety Gate no sender", "revalida opt-out • destino • quiet hours • caps • warmup • obsolescência", "CHANNEL SAFETY"), 980, 665, 380, 100, STYLES.red);
  g.addVertex("p4-deliver", label("Z-API → WhatsApp", "texto aprovado; modo ensaio redireciona até 5 mensagens", "DELIVERY"), 1460, 665, 330, 100, STYLES.green);
  g.addVertex("p4-feedback", label("Feedback da jornada", "sent → replied → converted • resposta volta pelo webhook e atualiza lead/conversa", "LOOP"), 530, 825, 830, 85, STYLES.teal);
  g.addEdge("p4-audience-data", "p4-segment", "consulta", STYLES.edgeDashed);
  g.addEdge("p4-dispatch", "p4-outbox", "somente aprovados", STYLES.edgeBlue, [[1770, 630], [1770, 640], [700, 640]]);
  g.addEdge("p4-outbox", "p4-safety", "sender worker", STYLES.edgeBlue);
  g.addEdge("p4-safety", "p4-deliver", "permitido", STYLES.edgeGreen);
  g.addEdge("p4-deliver", "p4-feedback", "reply/conversão", STYLES.edgeGreen);
  g.addEdge("p4-feedback", "p4-audience-data", "estado futuro", STYLES.edgeDashed);

  g.addVertex("p4-cron", label("Vercel Cron", "rotinas protegidas por CRON_SECRET", "SCHEDULER"), 80, 1080, 240, 150, STYLES.orange);
  g.addVertex("p4-follow", label("Follow-up", "lead some após interesse", "10h UTC diário"), 390, 1025, 300, 55, STYLES.blue);
  g.addVertex("p4-recovery", label("Recovery automática", "leads frios/cancelados/expirados", "12h + 21h"), 390, 1095, 300, 55, STYLES.blue);
  g.addVertex("p4-reminder", label("Lembrete D-1", "20–32h antes; idempotente", "13h UTC"), 390, 1165, 300, 55, STYLES.green);
  g.addVertex("p4-post", label("Pós-atendimento", "follow-up por regras", "a cada 30 min"), 390, 1235, 300, 55, STYLES.green);
  g.addVertex("p4-outbox2", label("enqueueOutboundMessage", "categorias follow_up • recovery • reminder • post_appointment", "OUTBOX"), 850, 1080, 420, 150, STYLES.queue);
  g.addVertex("p4-sender2", label("sender-worker", "mesma entrega, retry e segurança", "DELIVERY"), 1450, 1080, 320, 150, STYLES.orange);
  for (const id of ["p4-follow", "p4-recovery", "p4-reminder", "p4-post"]) {
    g.addEdge("p4-cron", id, "dispara", STYLES.edgeDashed);
    g.addEdge(id, "p4-outbox2", "enfileira", STYLES.edgeBlue);
  }
  g.addEdge("p4-outbox2", "p4-sender2", "message.send", STYLES.edgeBlue);

  g.addVertex("p4-note", `<b>Nota operacional</b><br>Alertas internos ao WhatsApp do responsável ainda usam um caminho operacional separado. Respostas e automações destinadas ao lead usam a outbox durável.`, 1605, 800, 200, 125, STYLES.note);
  return g.toXml();
}

const pages = [
  ["systemops-tech", "01 • Arquitetura técnica", page1()],
  ["systemops-conversation", "02 • Conversa e LLMs", page2()],
  ["systemops-product", "03 • Features e dados", page3()],
  ["systemops-campaigns", "04 • Campanhas e automações", page4()],
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="Electron" modified="2026-08-05T12:00:00.000Z" agent="SystemOps architecture generator" version="26.0.16" type="device" compressed="false" pages="${pages.length}">${pages.map(([id, name, body]) => `<diagram id="${id}" name="${escapeXml(name)}">${body}</diagram>`).join("")}</mxfile>\n`;

writeFileSync(OUTPUT, xml, "utf8");
console.log(`Generated ${OUTPUT}`);
