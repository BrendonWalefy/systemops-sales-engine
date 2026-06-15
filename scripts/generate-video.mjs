import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper para caminhos e diretórios
const keyPath = resolveKeyPath();
const videoAssetsDir = path.join(__dirname, '..', 'video-assets');

// Garante que o diretório de destino exista
if (!fs.existsSync(videoAssetsDir)) {
  fs.mkdirSync(videoAssetsDir, { recursive: true });
}

// Resoluções de caminhos flexíveis para gcp-key.json
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
  const bucketName = process.env.GCP_BUCKET_NAME;
  const location = process.env.GCP_LOCATION || 'us-central1';

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

  if (!projectId) {
    console.error('❌ Erro: GCP_PROJECT_ID não definido!');
    console.error('Por favor, defina a variável de ambiente: GCP_PROJECT_ID="seu-projeto-id"');
    console.exit ? console.exit(1) : process.exit(1);
  }

  if (!bucketName) {
    console.error('❌ Erro: GCP_BUCKET_NAME é obrigatório para salvar os vídeos gerados no Vertex AI.');
    console.error('Por favor, execute o script passando GCP_BUCKET_NAME=seu-bucket-gcs');
    process.exit(1);
  }

  console.log(`🤖 Iniciando gerador de vídeos com Vertex AI (Veo 2.0)...`);
  console.log(`📍 Projeto: ${projectId}`);
  console.log(`📍 Bucket GCS: ${bucketName}`);
  console.log(`📍 Região: ${location}`);

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

  const scenes = [
    {
      id: 1,
      name: '01_recepcao_whatsapp',
      prompt: 'A premium, modern dental clinic reception desk. A professional receptionist in a neat medical uniform is smiling warmly, typing on a modern computer. On the desk next to the computer, a sleek smartphone screen lights up showing WhatsApp notification badges. Elegant warm indoor lighting, high-end clean aesthetic, cinematic depth of field, 4k.',
      filename: '01_recepcao_whatsapp.mp4'
    },
    {
      id: 2,
      name: '02_lead_sistema',
      prompt: 'A conceptual modern software interface showing a new lead alert popping up with a glowing green status indicator. Smooth motion graphics displaying a profile picture card with text "Novo Lead: Lucas Silva - Interesse em Lentes". Professional, premium SaaS web design layout, dark mode aesthetic, clean UI, 4k.',
      filename: '02_lead_sistema.mp4'
    },
    {
      id: 3,
      name: '03_ia_respondendo',
      prompt: 'A close-up shot of a modern smartphone screen showing a fast, automated WhatsApp conversation. Chat bubbles are popping up instantly with professional Portuguese responses and a brief typing indicator before each bubble. Clean layout, high contrast, smooth scrolling, premium technology look, 4k.',
      filename: '03_ia_respondendo.mp4'
    },
    {
      id: 4,
      name: '04_agenda_preenchida',
      prompt: 'A close-up of a modern scheduling calendar grid on a tablet screen. Colorful reservation cards are smoothly appearing and slotting into open hours like 14:00, 15:30, and 17:00. High quality SaaS web interface, clean layout, professional and organized medical scheduler, 4k.',
      filename: '04_agenda_preenchida.mp4'
    },
    {
      id: 5,
      name: '05_dashboard_metricas',
      prompt: 'A premium analytics dashboard screen showing financial and operational charts. A line graph is trending steadily upwards representing "Agendamentos Concluídos" and "ROI". Clean dark mode aesthetic, neon green and cyan accents, futuristic professional business dashboard UI, 4k.',
      filename: '05_dashboard_metricas.mp4'
    },
    {
      id: 6,
      name: '06_clinica_noite',
      prompt: 'A cinematic view of a high-end empty dental clinic at night. Warm ambient architectural lighting is on inside. A sleek laptop on a desk is open and glowing, showing activity, representing the automated system working 24/7. Empty, peaceful, luxury workspace, 4k.',
      filename: '06_clinica_noite.mp4'
    }
  ];

  for (const scene of scenes) {
    const localDest = path.join(videoAssetsDir, scene.filename);
    if (fs.existsSync(localDest)) {
      console.log(`⏭️  Cena ${scene.id} (${scene.filename}) já existe localmente. Pulando...`);
      continue;
    }

    console.log(`\n🎬 [Cena ${scene.id}/6] Solicitando geração: "${scene.name}"`);
    console.log(`   Prompt: "${scene.prompt}"`);

    const gcsOutputFolder = `systemops_generation/${scene.name}_${Date.now()}`;
    const gcsOutputUri = `gs://${bucketName}/${gcsOutputFolder}`;

    // Endpoint do Vertex AI Veo 2.0 (predictLongRunning)
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

    const requestBody = {
      instances: [
        {
          prompt: scene.prompt
        }
      ],
      parameters: {
        aspectRatio: '16:9',
        durationSeconds: 5,
        outputGcsUri: gcsOutputUri
      }
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

      const operation = await response.json();
      const operationName = operation.name;
      console.log(`   Operação iniciada: ${operationName}`);
      console.log(`   Aguardando conclusão da geração de vídeo...`);

      // Polling para aguardar a operação
      const completedOp = await pollOperation(operationName, token, location, projectId);
      
      // Extrai o URI do vídeo gerado no GCS
      const generatedVideoUri = extractVideoUri(completedOp);
      if (!generatedVideoUri) {
        throw new Error(`Não foi possível extrair o URI do vídeo da resposta do Vertex AI: ${JSON.stringify(completedOp)}`);
      }

      console.log(`   Vídeo gerado no GCS: ${generatedVideoUri}`);
      
      // Baixa o vídeo do GCS para localmente
      console.log(`   Baixando vídeo para ${localDest}...`);
      await downloadGcsFile(generatedVideoUri, localDest, token, projectId);
      console.log(`   ✅ Cena ${scene.id} salva com sucesso!`);

    } catch (error) {
      console.error(`❌ Falha na geração da Cena ${scene.id}:`, error.message);
    }
  }

  console.log(`\n🎉 Processo de geração de vídeo concluído!`);
}

async function pollOperation(operationName, token, location, projectId) {
  // Para modelos generativos de mídia (como o Veo 2.0), a consulta da operação é feita via POST no endpoint fetchPredictOperation.
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/veo-2.0-generate-001:fetchPredictOperation`;
  const interval = 15000; // 15 segundos
  
  while (true) {
    await new Promise(resolve => setTimeout(resolve, interval));
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    if (projectId) {
      headers['x-goog-user-project'] = projectId;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ operationName })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`   ⚠️ Erro ao consultar operação (tentando novamente): ${errorText}`);
      continue;
    }
    
    const operation = await response.json();
    if (operation.done) {
      if (operation.error) {
        throw new Error(`Operação do GCP falhou: ${JSON.stringify(operation.error)}`);
      }
      return operation;
    }
    console.log(`   ...ainda processando...`);
  }
}

function extractVideoUri(operation) {
  try {
    const response = operation.response;
    if (response && response.generatedVideos && response.generatedVideos[0]) {
      return response.generatedVideos[0].video.uri;
    }
    if (response && response.predictions && response.predictions[0]) {
      return response.predictions[0].uri || response.predictions[0].gcsUri;
    }
  } catch (e) {
    console.warn(`Erro ao fazer parse da resposta da operação:`, e);
  }
  return null;
}

async function downloadGcsFile(gcsUri, localDest, token, projectId) {
  const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`URI de GCS inválido: ${gcsUri}`);
  }
  
  const bucket = match[1];
  const objectPath = match[2];
  
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;
  
  const headers = {
    'Authorization': `Bearer ${token}`
  };
  if (projectId) {
    headers['x-goog-user-project'] = projectId;
  }
  
  const response = await fetch(url, {
    headers: headers
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao baixar arquivo do GCS (${response.status}): ${errorText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(localDest, Buffer.from(arrayBuffer));
}

main().catch(console.error);
