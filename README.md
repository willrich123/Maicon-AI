# Maicon AI

O Maicon reúne chat, inteligência operacional e um portal web para consulta ao HeadCargo.

## Desenvolvimento local

1. Execute `npm ci`.
2. Copie `.env.example` para `.env` e preencha as configurações da sua instalação.
3. Execute `npm run dev` no Windows. Use `npm run build` para validar a compilação.

A biblioteca de telas usa um catálogo da instalação local. Para gerá-lo, execute `node scripts/extrair-headcargo.mjs "CAMINHO_DA_INSTALACAO"`. Em homologação, passe `server/porte/catalogo.homologacao.json.gz` como segundo argumento. Sem esse catálogo, a biblioteca começa vazia. A biblioteca de consultas SQL usa os arquivos locais em `sql/consultas/` quando disponíveis.
