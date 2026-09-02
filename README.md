# Watch With Me

Site responsivo para criar salas e assistir a vídeos do YouTube em sincronia no Android, iPhone ou computador.

## O que já funciona

- nome de usuário salvo apenas no aparelho;
- criação de sala com código numérico aleatório de quatro dígitos;
- entrada em sala existente;
- presença dos participantes conectados;
- chat persistente durante a vida da sala;
- link de convite que já preenche o código da sala;
- adição de vídeo por link do YouTube;
- sincronização de reprodução, pausa e mudança de posição;
- conexão direta entre os aparelhos na versão do GitHub Pages;
- correção automática de diferenças de tempo entre os aparelhos;
- botão de ativação do player para cumprir as restrições de reprodução do iPhone;
- salas inativas removidas automaticamente após 24 horas.

> O código de quatro dígitos é um filtro simples, não uma senha de segurança. Foi mantido assim porque o projeto foi pensado para grupos pequenos.

## Arquitetura

- **Interface:** React, TypeScript, Vinext/Vite e Tailwind CSS.
- **Player:** YouTube IFrame Player API.
- **GitHub Pages:** hospeda a interface estática acessada pelos usuários.
- **Salas no Pages:** conexão direta entre os navegadores, sem servidor próprio.
- **API:** Cloudflare Worker.
- **Banco:** D1/SQLite para salas, participantes e estado de reprodução.
- **Sincronização:** consultas leves ao estado da sala e correção local do player.

O vídeo continua sendo transmitido diretamente pelo YouTube. O servidor guarda somente o código da sala, nomes temporários, vídeo selecionado e posição da reprodução.

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

O resultado é gravado em `pages-dist/`. Cada envio para a branch `main` executa automaticamente lint, checagem de tipos, testes e as duas builds do projeto.

## Estrutura principal

- `components/watch-with-me.tsx`: entrada, sala, chat e integração com o YouTube.
- `app/api/rooms/`: criação, entrada e sincronização das salas.
- `db/schema.ts`: tabelas de salas e participantes.
- `pages/`: entrada estática usada pelo GitHub Pages.
- `.github/workflows/deploy-pages.yml`: validação automática do projeto.

## Limitações atuais

- anúncios do YouTube podem aparecer em momentos diferentes nos dois aparelhos;
- o primeiro início de reprodução pode exigir um toque em cada aparelho;
- no GitHub Pages, a sala encerra quando o criador fecha a página;
- qualquer pessoa que descobrir o código ativo consegue entrar na sala.
