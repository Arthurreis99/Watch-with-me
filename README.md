# Watch With Me

Site responsivo para criar salas e assistir a vídeos do YouTube em sincronia no Android, iPhone ou computador.

## Ver o site no navegador

A versão mais recente é publicada automaticamente em:

**https://arthurreis99.github.io/Watch-with-me/**

O GitHub Pages usa conexão direta entre os aparelhos para manter sala, vídeo e chat sincronizados.

## O que já funciona

- nome de usuário salvo apenas no aparelho;
- criação de sala com código numérico aleatório de quatro dígitos;
- entrada em sala existente;
- presença dos participantes conectados;
- chat com respostas, reações rápidas, mensagens pendentes e aviso sonoro opcional;
- link de convite que já preenche o código da sala;
- adição de vídeo por link do YouTube;
- sincronização de reprodução, pausa e mudança de posição;
- conexão direta entre os aparelhos na versão do GitHub Pages;
- volume individual salvo em cada aparelho, com curva perceptível no computador;
- controle móvel por mudo/som e pelos botões físicos do aparelho;
- restauração automática da conexão ao voltar para o Chrome;
- transferência automática do anfitrião quando ele sai e outra pessoa permanece;
- estado visível de conexão e botão manual para reconectar;
- fila compartilhada de vídeos, reordenação e reprodução automática do próximo;
- botão para ressincronizar e mensagens específicas para erros do YouTube;
- opção para restringir os controles ao anfitrião;
- bloqueio de novas entradas e convite protegido opcional;
- versão instalável como aplicativo, com tentativa de manter a tela acordada;
- histórico recente da sala armazenado somente no próprio aparelho;
- chat sincronizado com entrega otimista e reenvio após reconexão;
- correção automática de diferenças de tempo entre os aparelhos;
- botão de ativação do player para cumprir as restrições de reprodução do celular;
- sala mantida enquanto pelo menos um participante permanecer conectado.

> O código de quatro dígitos é um filtro simples, não uma senha de segurança. Foi mantido assim porque o projeto foi pensado para grupos pequenos.

## Arquitetura

- **Interface:** React, TypeScript, Vinext/Vite e Tailwind CSS.
- **Player:** YouTube IFrame Player API.
- **GitHub Pages:** hospeda a interface estática acessada pelos usuários.
- **Salas no Pages:** conexão direta entre os navegadores, sem servidor próprio.
- **API:** Cloudflare Worker.
- **Banco:** D1/SQLite para salas, participantes e estado de reprodução.
- **Sincronização:** consultas leves ao estado da sala e correção local do player.

O vídeo continua sendo transmitido diretamente pelo YouTube. No GitHub Pages, mensagens, nomes, fila e estado do player circulam diretamente entre os navegadores. Um histórico recente é salvo somente no armazenamento local de cada aparelho para permitir reconexão e transferência do anfitrião.

## Desenvolvimento

Requisitos: Node.js 22 ou mais recente.

```bash
npm install
npm run lint
npx tsc --noEmit
npm run build
```

Para gerar a versão estática do GitHub Pages:

```bash
npm run build:pages
```

O resultado é gravado em `pages-dist/`. Cada envio para a branch `main` executa automaticamente lint, checagem de tipos, testes, build e publicação na branch `gh-pages`.

## Estrutura principal

- `components/watch-with-me.tsx`: entrada, sala, chat e integração com o YouTube.
- `app/api/rooms/`: criação, entrada e sincronização das salas.
- `db/schema.ts`: tabelas de salas e participantes.
- `pages/`: entrada estática usada pelo GitHub Pages.
- `.github/workflows/deploy-pages.yml`: validação e publicação automática do projeto.

## Limitações atuais

- anúncios do YouTube podem aparecer em momentos diferentes nos dois aparelhos;
- o primeiro início de reprodução pode exigir um toque em cada aparelho;
- se todos os aparelhos forem fechados ao mesmo tempo, a sala deixa de existir;
- salas sem o convite protegido ainda podem ser acessadas por quem descobrir o código ativo.
