# Ponte HeadCargo: primeira etapa local

## Atualização: acesso pela conta Google do Maicon

O portal agora reutiliza o login Google existente do Maicon. `/headcargo` usa a mesma tela de entrada quando necessário; uma pessoa já autenticada não informa outra senha. A API da ponte valida o token do Maicon em todas as rotas de usuário, incluindo as consultas e a saída, e vincula o cookie desktop ao e-mail autenticado. Agentes continuam usando tokens próprios.

`GET /api/ponte/identidade` encontra o usuário correspondente por e-mail completo cadastrado em cad_Pessoa ou cad_Conta_Email, seguindo a relação cad_Funcionario → sys_Usuario. A consulta é somente SELECT, recusa vínculos ausentes/ambíguos e não consulta senhas. Não utiliza apenas o prefixo antes de @ como prova de identidade.

`POST /api/ponte/entrar` não usa usuário/senha enviados pelo navegador: resolve o vínculo no servidor e solicita `confirmar-identidade` ao agente. Para a conexão desktop, o HeadCargo deve estar previamente autenticado na sessão Windows dedicada, como o mesmo usuário. O agente verifica a identidade antes de disponibilizar dados. Google autentica o portal; não fornece nem substitui a senha do aplicativo nativo.

A identificação da conta no portal funciona independentemente da disponibilidade do agente. Se não houver desktop conectado para aquela pessoa, o portal mostra a conta identificada e a pendência de conexão, sem simular uma sessão HeadCargo. O mapeamento real dos controles ainda é necessário.

As instruções de login nativo automatizado abaixo descrevem a primeira proposta e foram substituídas por esse fluxo SSO. Nesta etapa, não preencher usuário/senha do HeadCargo pelo portal nem anunciar o modo antigo como disponível.

## O que está implementado

- Portal em `/headcargo`, separado do chat e do login Google.
- Gateway `/api/ponte` com login nativo delegado a agente Windows e cookie HttpOnly/Secure/SameSite Strict.
- Uma sessão web por agente/desktop configurado. Nenhum usuário escolhe o desktop de execução.
- Agente por sessão Windows, comunicação de saída HTTPS e token individual.
- Adaptador UI Automation configurável: login, identidade conectada, pesquisa de processo, aba Atividades, leitura estruturada da grade e logout.
- Consulta em tabela com `Ver mais`, sem descartar linhas recebidas.
- Controle de versão da tela, exclusão mútua de comandos, expiração por inatividade e isolamento após resultado incerto.
- Nenhuma conexão ou comando SQL na ponte. A etapa atual oferece somente consulta; não há alteração/conclusão de atividades pelo portal.

Os seletores do arquivo de exemplo são marcadores `MAPEAR_*`, não controles já validados do HeadCargo. O portal não aceita credenciais nem apresenta dados simulados sem um agente que confirme a autenticação no aplicativo real. Os testes de seis usuários usam agentes simulados; não demonstram capacidade física de seis sessões Windows.

## Preparar o gateway

1. Executar a API e a interface do projeto normalmente. O proxy local já encaminha `/api/ponte`.
2. Configurar `HC_PONTE_ORIGENS` com as origens HTTPS exatas, incluindo porta, sem barra final.
3. Configurar `HC_PONTE_AGENTES` como JSON de agentes: cada entrada contém `id`, `desktop` e `token`. Exemplo estrutural:

```json
[{ "id": "operacao-01", "desktop": "NOME-SERVIDOR:ID-SESSAO-WINDOWS", "token": "SUBSTITUIR-POR-SEGREDO-ALEATORIO-INDIVIDUAL" }]
```

Gerar tokens aleatórios de pelo menos 32 bytes com um gerenciador de segredos; não versionar valores reais. O token de cada agente deve ser diferente. O gateway rejeita desktops duplicados. A configuração vazia deixa o portal visível, informando indisponibilidade, sem usar implicitamente o desktop do bot atual.

O estado é mantido em memória. Esta etapa suporta uma instância de gateway; não iniciar réplicas com a mesma configuração. Reiniciar a API invalida as sessões web. Um agente que ainda encontre o HeadCargo autenticado será isolado até que o aplicativo seja encerrado/desconectado e a verificação inicial seja repetida em novo processo do gateway. Não há recuperação silenciosa de identidade.

## Preparar cada sessão Windows

1. Provisionar uma sessão Windows dedicada. Não compartilhar com o bot legado do Maicon nem com uso manual simultâneo. A criação de sessões RDS/VMs não é feita pelo código desta etapa.
2. Abrir o HeadCargo na tela de login. Não deixar o aplicativo autenticado como administrador.
3. Copiar `server/ponte/perfil.exemplo.json` para uma configuração local protegida e preencher os seletores reais. Não gravar usuário ou senha nesse arquivo.
4. Mapear controles únicos por `id` (AutomationId), `nome` (Name) ou ambos; `tipo` filtra o ControlType. O executável é conferido pelo caminho e pela sessão Windows atual. Janelas/controles ambíguos causam recusa.
5. O campo de senha deve expor `IsPassword`. O usuário pode ser Edit ou ComboBox editável; deve expor ValuePattern no próprio controle ou em um único Edit interno visível. Combos somente de seleção, controles ambíguos e campos vinculados TDBEdit são recusados. O controle de identidade deve apresentar exatamente o modelo `identidade.modelo`, substituindo `{usuario}` pelo login solicitado. Sem evidência confiável da identidade, não liberar o acesso.
6. A pesquisa deve ser um `Edit`/`TEdit` não vinculado a dados. O número aberto precisa ser confirmado em controle separado. A aba usa SelectionItemPattern e a grade usa GridPattern; índices das cinco colunas devem corresponder à tela real. Grades sem esses padrões exigem outro adaptador e são recusadas, sem inventar linhas ou usar SQL como substituto.
7. Definir no ambiente do agente: `HC_PONTE_AGENTE_ID`, `HC_PONTE_AGENTE_TOKEN`, `HC_PONTE_GATEWAY` e `HC_PONTE_PERFIL` (caminho absoluto do perfil).
8. Executar `npm run ponte:agente` dentro dessa sessão. O log informa apenas o ID e a chave do desktop `hostname:SessionId`; usar essa chave na configuração correspondente do gateway. O agente não carrega automaticamente o `.env` do gateway.

O certificado HTTPS do gateway deve ser confiável nos agentes. Não desativar validação TLS. O endpoint HTTP interno da API aceita somente loopback para a ponte; agentes remotos devem passar pelo proxy HTTPS, que deve encaminhar à API por loopback. Para outra topologia, configurar transporte TLS real antes de liberar acesso. Aplicar proteção contra tentativas de login também no proxy de entrada; o limitador local é por IP e usuário e não substitui controle distribuído.

As senhas passam pelo portal, gateway e processo PowerShell apenas durante a tentativa de login, via corpo HTTPS e stdin. Não aparecem em argumentos, arquivos de tarefas ou logs da aplicação. JavaScript e PowerShell não oferecem garantia de apagamento físico imediato de strings na memória. Não ativar captura de corpos HTTP ou dumps nesses processos.

## Validar antes do uso operacional

1. Com gateway sem agentes, abrir `/headcargo`: deve mostrar indisponibilidade.
2. Com uma sessão dedicada configurada e HeadCargo desconectado, conferir disponibilidade.
3. Entrar pelo próprio portal com credencial real; conferir a identidade nativa e a conta exibida. Não enviar senhas no chat.
4. Credencial inválida ou identidade divergente não libera sessão. Nesta etapa, falha de login isola o agente; verificar e limpar o estado nativo antes de reiniciar a verificação.
5. Consultar processo de teste e comparar todas as linhas/colunas da tabela com o HeadCargo. Confirmar mudança para a aba Atividades e testar `Ver mais`.
6. Sair: o desktop só volta ao conjunto disponível após logout nativo confirmado.
7. Repetir com seis sessões Windows reais, seis contas e seis processos distintos. Medir memória/CPU e latência. Verificar que fechar uma janela ou desconectar uma sessão não afeta as outras.

Operações que expiram não são repetidas automaticamente. O desktop é isolado. Se a pessoa sair durante uma operação, o cookie é invalidado e o desktop não é entregue a outro usuário com estado incerto. Após expiração em repouso, o gateway tenta logout nativo; se não confirmar, mantém o agente isolado.

## Verificações automatizadas

`node --test test/ponteHeadcargo.test.js` cobre seis sessões lógicas, autenticação dos agentes, associação ao desktop, identidade divergente, processo incorreto, comandos simultâneos, versão antiga, timeout, expiração, logout e cookies/CSRF do contrato HTTP. `npm run build` verifica TypeScript e gera o frontend. A validação real do login e da grade ainda depende do mapeamento e da infraestrutura Windows.
