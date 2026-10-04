# EBD — Sistema de Gestão da Escola Bíblica Dominical

Sistema independente em **Next.js 16 + TypeScript + SQLite**, com controle de acesso **ABAC** (função + atributos),
várias congregações, interface no padrão de aplicativo (instalável no celular, funciona sem internet na chamada)
e 149 testes automáticos.

## Como rodar

```bash
npm install
cp .env.example .env.local     # defina SESSION_SECRET (openssl rand -hex 32)
npm run seed                   # (re)cria data/ebd.db com a escala real do 4º tri/2026 + dados fictícios
npm run dev                    # http://localhost:3000
npm test                       # 149 testes
npm run build && npm start     # produção
```

**Atualizar o sistema não apaga dados**: o banco tem versão e cada mudança é uma migração automática
(v3 → v7 até aqui). Um banco da primeira entrega é atualizado sozinho ao abrir.

## Contas de demonstração (senha `ebd123`, domínio `@ebd.local`)

| Conta | Função | O que mostra |
|---|---|---|
| pastor@ | Pastor / Presidente | todas as congregações, visão consolidada, cria filiais e supervisores |
| supervisor@ | Supervisor regional | consulta (sem alterar) as duas filiais da região |
| super@ | Superintendente (Sede) | tudo na Sede; designa coordenadores; reabre relatórios |
| super.montesiao@ / super.oliveiras@ | Superintendente (filiais) | só a própria congregação |
| secretaria@ | Secretaria geral | valida relatórios, caixa, visitantes, biblioteca, certificados |
| coord.escala1@ / 2@ / 3@ | Coordenador (Rivanildo, Jaasiel, Wanclezia) | só a sua Escala, sem preencher relatórios |
| sec.atalaias@ | Colaborador e secretária da sala Atalaias | chamada, visitantes e oferta; envio do relatório |
| sec.campeoes@ | Aluna e secretária da sala Campeões de Cristo | idem, mesmo sendo aluna |
| prof.atalaias@ / prof.campeoes@ | Professor | plano de aula, quiz, materiais; assume a chamada só na ausência do secretário |
| colab.atalaias@ | Colaborador | consulta |
| aluno.atalaias@ | Aluno | portal do aluno: pontos, medalhas, quiz, certificados |

Troque as senhas e remova os dados fictícios antes de usar de verdade.

## Módulos

**Organização**
- Congregações: sede e filiais; Pastor/Presidente e Supervisor regional; troca de congregação e visão consolidada.
- Escalas (conjuntos de classes) com um coordenador cada; classes, equipe (professores, secretário da sala, colaboradores).
- Cadastro de pessoas com categorias, foto, ficha individual; importação por planilha (CSV); aniversariantes.
- Usuários e funções, redefinição de senha, "esqueci minha senha" (vai para a superintendência), login com Google (opcional).

**Domingo**
- Escala trimestral (T1 jan–mar … T4 out–dez), rodízio automático, domingos sem aula, folha impressa com o lema.
- Chamada no padrão de app (✓/✕, ações em massa, visitantes e oferta na mesma tela), **funciona sem internet** e envia
  sozinha quando a conexão volta; lista de chamada impressa (frequência manual).
- Relatório da aula: secretário da sala → (professor na ausência) → secretaria geral valida/devolve → consolidado.
- Chamada da equipe (colaboradores) por domingo. Diário (tema e observações) e plano de aula.

**Acompanhamento**
- Painel (BI): indicadores e tendência de 4 trimestres, por Escala e classe, termômetro (crescendo/estável/caindo),
  professores em destaque, alunos abaixo de 50%, ausentes com WhatsApp, visitantes, revistas, escala sem professor.
- Relatório consolidado (tela, impressão com timbre, CSV) e **apresentação em slides** do trimestre (tela cheia ou PDF).
- Visitantes com funil (visitou → voltou → matriculado). Financeiro: ofertas validadas e revistas entram sozinhas;
  despesas e outras entradas; fluxo por mês, categoria e classe.
- Material didático: revistas por aluno, pagamentos parciais e **pedido sugerido** pela média de presença.

**Comunicação**
- Comunicados por público (todos, equipe, professores, alunos, liderança, Escala, classe) com confirmação de leitura.
- Mural (fotos, testemunhos, pedidos de oração, avisos; publicações de alunos passam por aprovação; "Amém" e comentários).
- Notificações no app (sininho) e **push no celular**; agenda com confirmação de presença, "Adicionar ao Google Agenda",
  arquivo .ics e assinatura do calendário.
- Rotinas automáticas (todo dia a partir das 7h): cópia de segurança, aniversários, lembrete do professor escalado
  (sábado), lembrete de eventos (véspera), alunos com 3 faltas seguidas (segunda), relatórios enviados/devolvidos.

**Ensino**
- Lições do trimestre (cole o sumário da revista; ligam-se aos domingos e se reorganizam se um domingo virar "sem aula").
- Plano de aula do professor escalado, acompanhado pela coordenação.
- Quiz com pontuação (10 pontos por presença validada + 5 por acerto), ranking da turma e medalhas.
- Biblioteca: arquivos (PDF, slides), links e acervo de livros com empréstimos e atrasos.
- Certificados de frequência (mínimo configurável, padrão 75%) com timbre e logo, em PDF.
- Portal do aluno: pontos, posição, medalhas, próxima lição com leitura e texto áureo, quiz pendente, certificados.

## Modelo de acesso (ABAC)

A decisão combina a **função** com **atributos**: congregação, classes em que a pessoa atua (Escala do coordenador,
professor, colaborador, secretário da sala, matrícula), professor escalado na aula e situação do relatório.
Antes de qualquer regra há uma **barreira de congregação**: quem não é Pastor/Presidente nunca alcança dados de outra
congregação. Tudo é negado por padrão; as regras ficam em `src/lib/abac.ts` (`RULES`, com descrição em português) e
a matriz completa aparece em **Painel → Controle de acesso**.

Decisões que valem confirmar:
- Coordenador acompanha e organiza a sua Escala, mas não lança chamada (a não ser que seja secretário de uma sala).
- Professor só preenche a chamada se for o escalado e o secretário estiver ausente (ou a sala não tiver secretário).
- Quem enviou um relatório não o valida (exceto a superintendência); validado fica travado até a superintendência reabrir.
- Só o Pastor/Presidente cria congregações, concede as funções de Pastor e Supervisor e publica para todas as congregações.

## Celular (PWA) e sem internet

No celular a navegação vira barra inferior. Para instalar: Chrome (Android) → "Instalar app"; Safari (iPhone) →
Compartilhar → "Adicionar à Tela de Início". Para a chamada sem internet: com conexão, abra **Chamada** e toque em
"Preparar para usar sem internet"; sem conexão, faça a chamada normalmente — ela fica guardada no aparelho e é enviada
sozinha quando a conexão volta. Push e instalação exigem **HTTPS** em produção.

## Configuração (`.env.local`)

Veja `.env.example`: `SESSION_SECRET` (obrigatório), `EBD_PUBLIC_URL`, login com Google (`GOOGLE_CLIENT_ID/SECRET`,
redirecionamento `<EBD_PUBLIC_URL>/auth/google/callback`), chaves de push (opcionais; geradas automaticamente),
pastas de dados e chaves para desligar rotinas. Scripts: `npm run backup` (cópia agora) e `npm run rotinas`.

## Cópias de segurança

Automáticas, uma por dia (30 guardadas em `data/backups`), e manuais em **Configurações** (com download). Guarde uma
cópia fora do servidor de tempos em tempos. Fotos e arquivos ficam em `data/uploads` (inclua essa pasta no seu backup).

## Hospedagem

SQLite grava em arquivo local: use um servidor/VPS com disco persistente (ex.: uma máquina Linux com Node 20+,
`npm run build && npm start` atrás de um proxy HTTPS). **Em Vercel o disco é efêmero** — lá seria preciso trocar o banco
por Postgres; o SQL está concentrado em `src/lib/*.ts`.

## Estrutura

```
src/lib/abac.ts          motor ABAC + matriz de permissões        src/lib/db.ts        esquema e migrações
src/lib/repo.ts          classes, escala, chamada, relatórios      src/lib/church.ts    congregações, timbre, fotos
src/lib/visitors.ts      visitantes   finance.ts caixa   staffcall.ts chamada da equipe   insights.ts termômetro/pedido
src/lib/announcements.ts comunicados  mural.ts  agenda.ts  notify.ts (app + push)  jobs.ts rotinas diárias
src/lib/teaching.ts      lições e planos  quiz.ts  library.ts  certificates.ts  portal.ts
src/lib/importer.ts      importação CSV   google.ts login Google   backup.ts   uploads.ts
src/app/(app)/           telas            public/sw.js  app instalável, push e modo sem internet
scripts/seed.ts          dados de demonstração
```

## Fora do escopo (por enquanto)

Envio de e-mail/SMS (o "esqueci a senha" avisa a superintendência pelo app), integração por API com o Google Agenda
(usa-se a assinatura do calendário), pagamentos online e um app nas lojas (o PWA cumpre esse papel).
