import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const keyPath = resolveKeyPath();
const videoAssetsDir = path.join(__dirname, '..', 'video-assets');

if (!fs.existsSync(videoAssetsDir)) {
  fs.mkdirSync(videoAssetsDir, { recursive: true });
}

function resolveKeyPath() {
  const paths = [
    path.join(__dirname, 'gcp-key.json'),
    path.join(process.cwd(), 'gcp-key.json'),
    path.join(process.cwd(), 'scripts', 'gcp-key.json'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  let projectId = process.env.GCP_PROJECT_ID;

  // Tenta carregar do gcp-key.json se existir
  let keyData = null;
  if (keyPath) {
    try {
      keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      if (!projectId) {
        projectId = keyData.project_id;
      }
    } catch (e) {
      console.warn('⚠️ Falha ao ler gcp-key.json, tentando usar credenciais padrão do sistema...', e.message);
    }
  }

  // Nota: TTS não exige obrigatoriamente projectId, mas é bom para consistência.
  console.log(`🤖 Iniciando gerador de narrações com Google Cloud Text-to-Speech...`);
  if (projectId) {
    console.log(`📍 Projeto: ${projectId}`);
  }

  // Autenticação com o GCP (usa gcp-key.json se existir, senão busca o login local do gcloud)
  const authOptions = {
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  };
  if (keyPath) {
    authOptions.keyFile = keyPath;
  }
  const auth = new GoogleAuth(authOptions);
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse.token;

  const narrationSegments = [
    {
      id: 1,
      filename: '01_narration.mp3',
      text: 'Na correria do dia a dia, a recepção da sua clínica não precisa ficar sobrecarregada com centenas de mensagens no WhatsApp.'
    },
    {
      id: 2,
      filename: '02_narration.mp3',
      text: 'No exato momento em que um novo paciente demonstra interesse pelos seus tratamentos...'
    },
    {
      id: 3,
      filename: '03_narration.mp3',
      text: 'Nossa inteligência artificial entra em ação, respondendo instantaneamente, tirando dúvidas e qualificando o lead.'
    },
    {
      id: 4,
      filename: '04_narration.mp3',
      text: 'Sem qualquer esforço manual, a sua agenda vai sendo preenchida de forma inteligente, respeitando seus horários e preferências.'
    },
    {
      id: 5,
      filename: '05_narration.mp3',
      text: 'E você acompanha todo o crescimento da clínica em tempo real, com métricas claras de conversão e faturamento.'
    },
    {
      id: 6,
      filename: '06_narration.mp3',
      text: 'Enquanto você descansa, o sistema continua trabalhando vinte e quatro horas por dia. O futuro da gestão de clínicas está aqui.'
    }
  ];

  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize';

  for (const segment of narrationSegments) {
    const localDest = path.join(videoAssetsDir, segment.filename);
    if (fs.existsSync(localDest)) {
      console.log(`⏭️  Narração ${segment.id} (${segment.filename}) já existe localmente. Pulando...`);
      continue;
    }

    console.log(`🔊 [Segmento ${segment.id}/6] Gerando áudio para: "${segment.text}"`);

    const requestBody = {
      input: { text: segment.text },
      voice: { languageCode: 'pt-BR', name: 'pt-BR-Neural2-A' },
      audioConfig: { audioEncoding: 'MP3' }
    };

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    if (projectId) {
      headers['x-goog-user-project'] = projectId;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro na chamada da API (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (!data.audioContent) {
        throw new Error(`Nenhum conteúdo de áudio retornado do TTS: ${JSON.stringify(data)}`);
      }

      const audioBuffer = Buffer.from(data.audioContent, 'base64');
      fs.writeFileSync(localDest, audioBuffer);
      console.log(`   ✅ Segmento ${segment.id} salvo em ${localDest}!`);

    } catch (error) {
      console.error(`❌ Falha na geração da Narração ${segment.id}:`, error.message);
    }
  }

  console.log(`\n🎉 Processo de geração de áudio concluído!`);
}

main().catch(console.error);
