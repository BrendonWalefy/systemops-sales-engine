# Task: PWA — Instalação na Tela Inicial

Transforme o sistema em um Progressive Web App instalável, permitindo que operadores
adicionem o ícone à tela inicial do celular e usem o app em fullscreen, sem barra do navegador.

---

## CONTEXTO DO PROJETO

SaaS de recepcionista autônoma para clínicas. Interface usada por operadores (recepcionistas,
donos de clínica) que frequentemente estão no celular. Stack: Next.js 14 App Router, Vercel.

O app JÁ tem layout responsivo completo (media queries em `globals.css` com breakpoints
em 560/640/860/1180px — sidebar vira bottom nav em ≤640px). O que falta é a camada
de "instalabilidade" do PWA: manifest, ícones e meta tags.

---

## ESCOPO DESTA TASK

Fase 1 — somente instalabilidade. NÃO implementar:
- Service worker com cache offline (complexidade alta, ganho baixo no B2B)
- Push notifications (depende de service worker robusto — fase futura)
- Nenhuma mudança no layout ou CSS existente

O resultado: operador acessa o site pelo Chrome/Safari mobile → botão "Adicionar à tela inicial"
aparece → app abre em fullscreen sem barra do navegador, com ícone próprio.

---

## O QUE CONSTRUIR

### 1. Ícones do app
Criar os seguintes arquivos em `public/icons/`:

- `icon-192.png` — 192×192px
- `icon-512.png` — 512×512px
- `apple-touch-icon.png` — 180×180px (iOS)

Design sugerido: fundo escuro (`#0a0a0a` — cor do sidebar do app) com o símbolo
de raio ⚡ centralizado em branco/verde (`#10b981` — accent do design system).
Se não tiver ferramenta para gerar PNG, criar SVG e converter via `sharp` ou usar
`canvas` em um script Node.js. Pode também usar placeholder colorido simples.

IMPORTANTE: Os ícones precisam ser PNG reais (não SVG) para funcionar no iOS Safari.

### 2. Manifest
Criar: `src/app/manifest.ts`

Usar a API nativa do Next.js 14 (retorna `MetadataRoute.Manifest`):

```typescript
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SystemOps",
    short_name: "SystemOps",
    description: "Recepcionista autônoma para clínicas",
    start_url: "/app/inbox",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
```

`start_url: "/app/inbox"` — abre direto no Inbox quando o operador toca no ícone.

### 3. Metadata no layout raiz
Arquivo: `src/app/layout.tsx`

Substituir o conteúdo atual (hoje só tem html+body) por:

```typescript
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export const metadata: Metadata = {
  title: "SystemOps",
  description: "Recepcionista autônoma para clínicas",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SystemOps",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
    icon: "/icons/icon-192.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

NOTA: No Next.js 14, `viewport` é exportado separado de `metadata` — não misturar.

---

## REGRAS DE IMPLEMENTAÇÃO

1. Não instalar `next-pwa` nem qualquer biblioteca adicional — Next.js 14 tem suporte nativo
   a manifest via `app/manifest.ts` e metadata via `export const metadata`
2. Não criar `public/manifest.json` manualmente — o `app/manifest.ts` gera automaticamente
   em `/manifest.webmanifest` (Next.js serve automaticamente)
3. Não adicionar `<link rel="manifest">` manualmente no HTML — o `metadata.manifest` já faz isso
4. `start_url` deve ser `/app/inbox` — não `/` (evita redirect desnecessário para o operador)
5. `display: "standalone"` é o correto para remover a barra do navegador
6. `background_color` e `theme_color` devem ser `#0a0a0a` — cor de fundo do app (sem flash branco ao abrir)
7. Verificar as cores reais do design system em `src/app/globals.css` antes de hardcodar
   (buscar por `--bg` ou `background` no `:root`)

---

## TESTES

Esta feature não tem lógica de negócio — os testes são manuais.

Checklist de validação manual (fazer em celular real, não emulador):

**Android (Chrome):**
1. Abrir o app no Chrome mobile
2. Tocar nos 3 pontos → "Adicionar à tela inicial" ou banner automático deve aparecer
3. Instalar e abrir pelo ícone da tela inicial
4. Confirmar: abre em fullscreen (sem barra do navegador), ícone correto, cor de tema escura

**iOS (Safari):**
1. Abrir o app no Safari mobile
2. Tocar em Compartilhar → "Adicionar à tela inicial"
3. Confirmar nome "SystemOps" e ícone correto no preview
4. Instalar e abrir — fullscreen, sem barra do Safari

**Lighthouse (Chrome DevTools):**
1. Abrir DevTools → aba Lighthouse → categoria "Progressive Web App"
2. Rodar auditoria
3. Deve passar nos critérios de instalabilidade (ícones, manifest, HTTPS)

---

## DEPLOY

1. Rodar `npx tsc --noEmit` — zero erros de TypeScript
2. Rodar `npm test` — todos os testes existentes passando (76)
3. Commitar `src/app/manifest.ts`, `src/app/layout.tsx` e `public/icons/`
4. Push para `main` → deploy automático na Vercel (já tem HTTPS — requisito para PWA)

Validação pós-deploy:
- Acessar a URL de produção em Chrome mobile → botão "Adicionar à tela inicial" aparece
- Verificar `https://<url>/manifest.webmanifest` retorna JSON válido com os ícones
- Verificar `https://<url>/icons/icon-192.png` carrega corretamente

---

## ARQUIVOS DE REFERÊNCIA (ler antes de começar)

- `src/app/layout.tsx` — arquivo a modificar (hoje apenas 9 linhas)
- `src/app/globals.css` — verificar as cores do design system (`:root` variables)
  para usar `background_color` e `theme_color` corretos no manifest

---

## CHECKLIST FINAL

- [ ] `public/icons/icon-192.png` criado (192×192)
- [ ] `public/icons/icon-512.png` criado (512×512)
- [ ] `public/icons/apple-touch-icon.png` criado (180×180)
- [ ] `src/app/manifest.ts` criado com `start_url: "/app/inbox"`
- [ ] `src/app/layout.tsx` atualizado com `metadata` e `viewport` exports
- [ ] `tsc --noEmit` sem erros
- [ ] `npm test` todos os testes verdes
- [ ] Commit + push para main
- [ ] `/manifest.webmanifest` acessível em produção e retorna JSON válido
- [ ] Botão "Adicionar à tela inicial" aparece no Chrome mobile em produção
- [ ] App abre em fullscreen ao tocar no ícone instalado
