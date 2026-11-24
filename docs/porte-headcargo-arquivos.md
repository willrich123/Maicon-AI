# Porte web baseado nos arquivos instalados

## Workspace 3.0 e Maicon integrado

A interface principal foi reformulada: lista de processos pesquisável à esquerda, área central de dados e assistente Maicon à direita. O número do processo é anexado às perguntas enviadas ao `/api/chat` existente. Resumos, prioridades e perguntas por atividade usam a conversa e as ferramentas do Maicon com a sessão autenticada, sem novas credenciais. Trocar de processo abre um contexto de conversa separado e não repete automaticamente pedidos de outro processo. Essa integração não amplia as permissões nem remove as restrições existentes do bot.

O adaptador Google preserva thoughtSignature nas chamadas recebidas, inclusive em streaming, e devolve a assinatura no próximo pedido. Há testes de ida e volta; não se fabricam assinaturas para históricos antigos. Conversas antigas que já perderam a assinatura devem ser reiniciadas pelo botão Nova conversa. A regra está descrita na [documentação Google](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures).

As fichas são agrupadas por identificação, envolvidos, carga, datas, situações e instruções. Datas e booleanos usam tipos SQL canônicos (incluindo aliases do banco), números usam padrão pt-BR e referências de pessoa mapeadas são resolvidas por SELECT parametrizado. IDs continuam disponíveis na opção Mostrar identificadores internos. Status numéricos sem mapeamento comprovado não são traduzidos por suposição.

O servidor de desenvolvimento foi ajustado para atualização automática. O endereço local foi conferido e entrega o componente marcado como workspace-3. A marca Workspace 3.0 no cabeçalho permite identificar a interface carregada.

## Organização operacional inspirada no HeadCargo

A rota principal agora abre um ambiente compacto, com barra superior de ações, detalhes do processo à esquerda e listagem real filtrável à direita. Os modos Listagem/Completo/Dados alternam os painéis. A barra oferece localizar, atualizar e imprimir; não exibe ações de gravação que ainda não estão integradas.

As seções são organizadas em Processo, Comissões, Taxas, Faturas, Atividades, Acompanhamentos, Mensagens e Arquivos, conforme a disponibilidade para a conta. Dentro de Processo há atalhos para House, Master, Contatos, Carga e Campos livres, com as demais seções no seletor Mais dados. O catálogo de estruturas ficou em `/headcargo/catalogo`, acessível por Outras telas, fora do fluxo principal.

A listagem usa paginação de 50 itens, filtro parametrizado por número/cliente/referência e a mesma restrição por participação/modalidade das consultas individuais. A consulta real com filtro pelo processo de teste foi validada. A revisão visual no Chrome foi interrompida por interação local do usuário; o build e os testes automatizados passaram.

## Resultado desta etapa

O portal `/headcargo` foi substituído por um workspace web próprio, com acesso Google do Maicon, navegação por módulos, pesquisa de telas e consulta de processos/atividades por SELECT. Esse caminho não depende do agente desktop. A ponte anterior foi preservada em `/headcargo/desktop` e continua dependente de configuração.

Foram lidos estaticamente 150 arquivos PE (`.exe`, `.hsm`, `.bpl`) da instalação. A leitura dos recursos recuperou 1.174 definições DFM sem falhas nesta versão. Foram selecionadas 819 telas `Tfrm*` de 40 módulos `.hsm` para o navegador; os demais recursos incluem frames reutilizáveis, módulos de dados e componentes das bibliotecas. Esses números não representam 819 funcionalidades completas.

`server/porte/catalogo.json.gz` contém somente a estrutura filtrada dos formulários, proveniência por arquivo/recurso e hashes SHA-256 dos arquivos lidos. Não contém executáveis, credenciais, textos de conexão, conteúdo de campos em runtime, SQL incorporado ou handlers. O aplicativo instalado não foi modificado. O JSON sem compressão não é necessário.

A validação com o processo de teste `IM2099-25 teste` confirmou o vínculo da conta, a consulta de 115 atividades e a expansão de 10 para 20 linhas no Chrome autenticado. A pesquisa e abertura da estrutura “Compara processo/oferta” também foram verificadas na interface real. Essa verificação não cobre dados ou comportamentos dos outros módulos.

O leitor PE/DFM foi implementado no repositório. Essa leitura é evidência estática obtida por ferramentas locais; não é saída de decompilação do REA. O diagnóstico do REA constatou ausência de registro no Codex, runtime Node abaixo do requisito dessa versão e ausência de motores nativos. Nenhum registro, engine ou runtime foi alterado para reparar isso.

## O que já funciona e o que é estrutura

| Parte | Comportamento |
| --- | --- |
| Login | Usa a sessão Google validada do Maicon e o vínculo único do e-mail com o usuário HeadCargo |
| Módulos e busca | Navega pelas telas recuperadas dos arquivos originais |
| Formulários | Exibe grupos, rótulos e campos recuperados; usa frames disponíveis para completar a estrutura |
| Processo e atividades | Consulta real parametrizada, sem limite silencioso de atividades, com Ver mais na apresentação |
| Demais dados | Ainda não conectados; campos mostram explicitamente essa condição |
| Botões/regras nativas | Não executados nem reconstruídos por esta etapa |
| Escrita no ERP | Ausente: nenhuma rota de INSERT, UPDATE, DELETE, EXEC ou salvamento genérico |

Os formulários DFM descrevem apresentação, referências e componentes; não contêm a implementação completa dos eventos compilados. A estrutura recuperada não demonstra equivalência de regras, cálculos ou permissões de cada módulo. Não disponibilizar operações financeiras, integrações, faturamento ou conclusão de tarefas como funcionais a partir desses metadados.

## Dados e acesso

O processo agora oferece abas de dados operacionais. No teste real, 47 seções responderam sem erro, incluindo 158 colunas do house, 60 do master, 261 acompanhamentos, 12 vínculos de arquivos, dados marítimos, contêineres, viagens e campos livres. A interface busca lotes de 50 registros e informa o total; campos vazios podem ser exibidos e os campos podem ser pesquisados. Esses números são do processo de teste e não demonstram cobertura de todos os processos/módulos.

Arquivos têm apresentação própria com grupos, busca e paginação de 30 itens. A abertura e o download verificam novamente o vínculo do anexo com o processo autorizado. Conteúdos locais são recuperados e descompactados conforme o formato nativo; conteúdos externos usam o serviço oficial Headsoft e seu redirecionamento para o armazenamento Azure validado. Tokens e URLs assinadas permanecem no servidor. PDF e imagens reconhecidas pelo conteúdo têm visualização; outros formatos são baixados. O limite é de 50 MB por arquivo. A integração foi validada na homologação com o PDF de 137.047 bytes e o PNG do processo mostrado pelo usuário.

O manifesto de tabelas e o esquema lido no servidor determinam as consultas. Registros de tabelas que também têm vínculo com master são filtrados pelo house quando esse campo existe, evitando misturar outros houses do mesmo master. Seções financeiras exigem administrador ou recorte financeiro. Campos de senha/token/conexão e tipos binários não entram na resposta. A consulta verifica o acesso ao processo antes de acessar cada seção.

A consulta de processos resolve o vínculo no servidor. Administradores Maicon podem consultar processos inclusive de teste. As demais contas precisam participar do projeto ou ser responsáveis por uma de suas atividades; processos de teste são recusados e a modalidade configurada é respeitada. Isso é o escopo explícito desta etapa, não uma reprodução comprovada de toda a matriz de permissões do ERP.

Nenhum nome de tabela/coluna, SQL ou indicação de administrador vindo do navegador é executado. Os dois SELECTs são fixos e parametrizados, passam pelo pool protegido do Maicon e não recuperam dados financeiros. As rotas web exigem autenticação, identidade vinculada e origem permitida nas requisições POST. A aplicação deve usar credenciais SQL com permissões efetivas de leitura no ambiente de implantação.

## Reproduzir

- `node scripts/extrair-headcargo.mjs`: reconstrói o catálogo a partir da instalação local, sem carregar os módulos em memória como código. Um diretório alternativo pode ser passado como primeiro argumento.
- `node --test test/porteWeb.test.js test/ponteHeadcargo.test.js`: valida leitura, limites, autorização, SSO e contratos.
- `npm run build`: valida e gera o frontend.
- `node scripts/verificar-porte.mjs EMAIL NUMERO_PROCESSO`: verifica vínculo e consulta real somente de leitura; imprime apenas estado e contagem, sem dados do processo ou credenciais.

Não publicar os módulos comerciais originais nem os arquivos de conexão junto com o portal. O catálogo usa somente a projeção necessária para a reconstrução interna solicitada.

## Referências do formato

- Embarcadero: [TReader](https://docwiki.embarcadero.com/Libraries/Alexandria/en/System.Classes.TReader) e [TValueType](https://docwiki.embarcadero.com/Libraries/Athens/en/System.Classes.TValueType).
- Free Pascal: [tipos do stream de propriedades](https://docs.freepascal.org/docs-html/rtl/classes/tvaluetype.html).
