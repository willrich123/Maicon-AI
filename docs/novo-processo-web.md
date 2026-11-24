# Criação de processos pelo portal

Implementação inicial em homologação. A opção **+ Novo** abre um formulário com modalidade, cliente do cadastro HeadCargo e referência. O portal envia uma tarefa e acompanha os estados fila, execução, conclusão ou conferência necessária. Fechar e reabrir o formulário recupera a solicitação pela chave mantida na sessão do navegador.

## Gravação e verificação

O caminho de gravação é o formulário original: abrir Operacional, selecionar a modalidade, acionar Inserir, resolver o cliente pelo cadastro, preencher a referência e acionar Confirmar. A numeração pertence ao HeadCargo. O adaptador usa seletores UI Automation locais, confirma a identidade nativa e recusa edição preexistente, seletores ambíguos e incompatibilidade de elevação.

O servidor faz somente SELECT no SQL Server do HeadCargo: consulta de clientes, marco anterior à criação e conferência do número retornado pela tela, modalidade, cliente e referência. A confirmação exige um identificador de house posterior ao marco consultado. Não executa INSERT, UPDATE, DELETE, procedures de gravação nem tenta reproduzir as regras internas em SQL.

O histórico da tarefa usa SQLite local do Maicon, em `criacao-processos-homologacao.sqlite`. Essa persistência local não é uma alteração direta no banco do ERP. A chave de solicitação evita repetir a criação por duplo clique, timeout HTTP ou reinício. Tarefas interrompidas passam a conferência, sem repetição automática. O status só fica disponível ao proprietário autenticado.

## Ativação ainda pendente

Não houve criação real validada. A inspeção não expôs uma janela controlável do HeadCargo, portanto os seletores reais de inclusão ainda não foram mapeados. O perfil de exemplo contém `MAPEAR`, `validado=false` e `sessaoDedicada=false`; não é um perfil operacional. O portal informa essa indisponibilidade e não aceita tarefas nativas enquanto ela persistir.

Após observar e validar os controles reais, preencher um perfil local a partir de `server/porte/perfil-criacao.exemplo.json` e apontar `HC_CRIACAO_PERFIL` para ele. Nunca marcar um perfil como validado apenas para remover a mensagem do portal.

A implementação inicial exige administrador Maicon e `HC_AMBIENTE=homologacao`. A conta Google é vinculada ao usuário HeadCargo; o adaptador confere que a sessão nativa pertence a esse usuário, sem receber senha.

## Segundo plano

A tarefa é assíncrona para o navegador, mas a automação nativa continua exigindo uma sessão Windows interativa, desbloqueada e dedicada ao bot. Ela não permite usar simultaneamente o mesmo desktop para trabalho manual. A infraestrutura com vários usuários precisa de sessões isoladas por identidade; esta fila local não cria esses desktops nem habilita uma sessão nativa compartilhada para outras contas.

O primeiro teste real ainda precisa de modalidade, cliente e referência escolhidos pelo usuário, além dos controles validados. Outros campos exigidos pelo cadastro nativo levarão a conferência; o fluxo atual não afirma cobrir todos os campos e modalidades do HeadCargo.
