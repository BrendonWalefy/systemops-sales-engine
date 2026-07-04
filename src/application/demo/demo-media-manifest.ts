/**
 * Biblioteca de mídia PRÓPRIA da clínica demo (fotos/vídeos de procedimentos).
 *
 * Este arquivo é GERADO por `scripts/upload-demo-media.ts`, que sobe os arquivos
 * de `scripts/demo-media/` para o Vercel Blob (prefixo `demo-media/`, permanente —
 * o cron de limpeza só apaga o prefixo `tts/`) e reescreve a lista abaixo.
 *
 * Enquanto estiver vazio, o seed cai no fallback: reusa a biblioteca da Ximendes.
 *
 * Dica: nomeie os arquivos com a palavra-chave do procedimento (ex.: `lentes.mp4`,
 * `implante.mp4`, `porcelana-antes-depois.jpg`) — os roteiros selecionam o item
 * por `mediaQuery` casando com o título derivado do nome do arquivo.
 */
export type DemoMediaItem = {
  id: string;
  title: string;
  url: string;
  type: "video" | "image";
};

export const DEMO_MEDIA_MANIFEST: DemoMediaItem[] = [
  {
    "id": "c470ddcc-cf9d-4320-bc34-a1e22975bbfd",
    "title": "Implante",
    "url": "https://wdambmfza8itfgaf.public.blob.vercel-storage.com/demo-media/implante-rjK3AWSHRwBWGYahNGAzv2ShbAlfC2.mp4",
    "type": "video"
  },
  {
    "id": "e4828614-563b-4ee8-a1d4-23752d060855",
    "title": "Lentes",
    "url": "https://wdambmfza8itfgaf.public.blob.vercel-storage.com/demo-media/lentes-Pf8fJv4hrGUEOpRg6TGJllN3FbqvSA.mp4",
    "type": "video"
  },
  {
    "id": "39aca959-ba61-4243-866d-4618dd1a8a2d",
    "title": "Porcelana",
    "url": "https://wdambmfza8itfgaf.public.blob.vercel-storage.com/demo-media/porcelana-l32LUQ1B7HwJZGcNnhkFmildl1ULhf.mp4",
    "type": "video"
  },
  {
    "id": "b42eb5a1-c046-4545-be7c-1327820cb382",
    "title": "Sorriso antes depois",
    "url": "https://wdambmfza8itfgaf.public.blob.vercel-storage.com/demo-media/sorriso-antes-depois-sd3e1gRCUuPCd62PzJWv3ASMeCl6VM.jpeg",
    "type": "image"
  }
];
