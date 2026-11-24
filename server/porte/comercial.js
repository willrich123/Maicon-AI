import sql from 'mssql';
import { FalhaPonte } from '../ponte/sessoes.js';
import { mapaComercialWeb } from './catalogo.js';
import { prepararCamposProposta } from './camposProposta.js';
import { valorCampoLivre } from './valores.js';

const situacao = ['—', 'Aguardando aprovação', 'Aprovada', 'Não aprovada', 'Não enviada', 'Pré-proposta', 'Enviada'];
const proposta = 'FROM mov_Proposta_Frete P LEFT JOIN cad_Pessoa C ON C.IdPessoa=P.IdCliente';
const recorteOferta = alias => `(@admin=1 OR @modal='' OR
 (${alias}.Modalidade_Processo=@transporte AND ${alias}.Tipo_Operacao=@operacao))`;
const escopo = `(@admin=1 OR ((P.IdVendedor=@pessoa OR P.IdResponsavel=@pessoa
 OR EXISTS (SELECT 1 FROM mov_Projeto_Atividade_Responsavel R WHERE R.IdProjeto_Atividade=P.IdProjeto_Atividade AND R.IdResponsavel=@pessoa))
 AND (@modal='' OR EXISTS (SELECT 1 FROM mov_Oferta_Frete M WHERE M.IdProposta_Frete=P.IdProposta_Frete AND ${recorteOferta('M')}))))`;
const campos = 'P.Numero_Proposta AS Proposta,C.Nome AS Cliente,P.Situacao,P.Data_Proposta AS Data';
const rota = (origem, destino) => `LEFT JOIN cad_Origem_Destino A ON A.IdOrigem_Destino=${origem} LEFT JOIN cad_Origem_Destino B ON B.IdOrigem_Destino=${destino}`;
const pessoa = id => `LEFT JOIN cad_Pessoa C ON C.IdPessoa=${id}`;

const tarifarios = {
 maritimo: ['Marítimo', 'mov_Tarifario_Maritimo', 'IdTarifario_Maritimo', 'T.Numero', 'T.IdArmador', 'T.Data_Validade'],
 aereo: ['Aéreo', 'mov_Tarifario_Aereo', 'IdTarifario_Aereo', 'NULL', 'T.IdCompanhia_Aerea', 'T.Data_Validade', 'T.IdAeroporto_Origem', 'T.IdAeroporto_Destino'],
 terrestre: ['Terrestre', 'mov_Tarifario_Terrestre', 'IdTarifario_Terrestre', 'NULL', 'T.IdTransportadora', 'T.Data_Termino_Vigencia', 'T.IdOrigem', 'T.IdDestino'],
 local: ['Taxas locais', 'mov_Tarifario_Origem_Destino', 'IdTarifario_Origem_Destino', 'T.Numero', 'COALESCE(T.IdCompanhia_Transporte,T.IdPessoa)', 'T.Data_Validade', 'T.IdOrigem_Destino', 'NULL'],
 demurrage: ['Demurrage', 'mov_Tarifario_Demurrage', 'IdTarifario_Demurrage', 'T.Numero', 'T.IdArmador', 'T.Data_Termino_Vigencia', 'T.IdPorto', 'NULL'],
};
const taxasTarifario = {
 aereo: ['mov_Tarifario_Aereo_Taxa', 'T.IdTarifario_Aereo=@id', 'T.IdTarifario_Aereo_Taxa'],
 terrestre: ['mov_Tarifario_Terrestre_Taxa', 'T.IdTarifario_Terrestre=@id', 'T.IdTarifario_Terrestre_Taxa'],
 local: ['mov_Tarifario_Taxa', 'T.IdTarifario_Origem_Destino=@id', 'T.IdTarifario_Taxa'],
 maritimo: ['mov_Tarifario_Maritimo_Taxa', `ISNULL(T.Restrita,0)=0 AND (
   EXISTS(SELECT 1 FROM mov_Tarifario_Maritimo_Rota R WHERE R.IdTarifario_Maritimo_Rota=T.IdTarifario_Maritimo_Rota AND R.IdTarifario_Maritimo=@id)
   OR EXISTS(SELECT 1 FROM mov_Tarifario_Maritimo_Agrupamento G WHERE G.IdTarifario_Maritimo_Agrupament=T.IdTarifario_Maritimo_Agrupament AND G.IdTarifario_Maritimo=@id))`,
   'T.IdTarifario_Maritimo_Taxa'],
};
const oferta = 'FROM mov_Oferta_Frete O';
const porOferta = (t, fk='IdOferta_Frete') => `FROM ${t} T JOIN mov_Oferta_Frete O ON O.IdOferta_Frete=T.${fk}`;
const ofertas = {
 ofertas: ['Ofertas', `O.Numero_Oferta AS Oferta, C.Nome AS Transportadora,A.Nome AS Origem,B.Nome AS Destino,
 O.Data_Validade AS [Válida até],O.Transit_Time AS [Trânsito (dias)], I.Codigo AS Incoterm,O.Ativo`,
 `${oferta} ${rota('O.IdOrigem','O.IdDestino')} ${pessoa('O.IdCompanhia_Transporte')} LEFT JOIN cad_Incoterm I ON I.IdIncoterm=O.IdIncoterm`, 'O.IdOferta_Frete DESC'],
 viagens: ['Viagens', 'O.Numero_Oferta AS Oferta,T.Sequencia AS [Etapa],A.Nome AS Origem,B.Nome AS Destino,C.Nome AS Transportadora,T.Viagem_Voo AS [Viagem ou voo],T.Data_Previsao_Embarque AS Embarque,T.Data_Previsao_Desembarque AS Desembarque',
 `${porOferta('mov_Oferta_Frete_Viagem')} ${rota('T.IdOrigem','T.IdDestino')} ${pessoa('T.IdCompanhia_Transporte')}`, 'O.IdOferta_Frete,T.Sequencia,T.IdOferta_Frete_Viagem'],
 contatos: ['Contatos', `O.Numero_Oferta AS Oferta,C.Nome AS Transportadora,AG.Nome AS [Agência],AO.Nome AS [Agente de origem],AD.Nome AS [Agente de destino],
   EX.Nome AS Exportador,IM.Nome AS Importador,N.Nome AS Notify,D.Nome AS Despachante,R.Nome AS Representante,
   RD.Nome AS [Representante no destino],AI.Nome AS [Associação internacional],S.Nome AS Seguradora`,
   `${oferta} ${pessoa('O.IdCompanhia_Transporte')}
   ${Object.entries({AG:'Agencia_Maritima_Aerea',AO:'Agente_Origem',AD:'Agente_Destino',EX:'Exportador',IM:'Importador',N:'Notify',D:'Despachante_Aduaneiro',R:'Representante',RD:'Representante_Destino_Final',AI:'Associacao_Internacional',S:'Seguradora'}).map(([a,c])=>`LEFT JOIN cad_Pessoa ${a} ON ${a}.IdPessoa=O.Id${c}`).join(' ')}`, 'O.IdOferta_Frete'],
 informacoes: ['Informações', `O.Numero_Oferta AS Oferta,O.Referencia_Cliente AS [Referência do cliente],O.Referencia_Externa AS [Referência externa],
   O.Data_Validade AS Validade,O.Validade_Dias AS [Validade em dias],O.Detalhes,O.Observacao AS [Observação],
   O.Local_Coleta AS Coleta,O.Local_Entrega AS Entrega,O.Rota,O.Ativo`, oferta,'O.IdOferta_Frete'],
 remarks: ['Remarks','O.Numero_Oferta AS Oferta,O.Remarks,O.Remarks_Terrestre AS [Remarks terrestre],O.Remarks_Free_Time AS [Remarks free time]',oferta,'O.IdOferta_Frete'],
 adicionais: ['Informações adicionais', `O.Numero_Oferta AS Oferta,C.Descricao AS Campo,C.Tipo_Valor,CONVERT(nvarchar(max),C.Itens) AS Itens,
   T.Valor_Alfanumerico,CONVERT(nvarchar(max),T.Valor_Texto) AS Valor_Texto,T.Valor_Data,T.Valor_Inteiro,T.Valor_Real4,T.Valor_Boleano,T.Valor_Tipo_Fixo`,
   `FROM mov_Oferta_Frete_Campo_Livre L JOIN mov_Oferta_Frete O ON O.IdOferta_Frete=L.IdOferta_Frete
   JOIN mov_Campo_Livre T ON T.IdCampo_Livre=L.IdCampo_Livre
   JOIN cad_Configuracao_Campo_Livre C ON C.IdConfiguracao_Campo_Livre=T.IdConfiguracao_Campo_Livre`, 'O.IdOferta_Frete,C.Precedencia,T.IdCampo_Livre'],
 coletaEntrega: ['Coleta e entrega','O.Numero_Oferta AS Oferta,O.Local_Coleta AS Coleta,O.Local_Entrega AS Entrega',
   oferta,'O.IdOferta_Frete'],
 complemento: ['Complemento','O.Numero_Oferta AS Oferta,O.Rota,O.Observacao AS [Observação],O.Transit_Time AS [Trânsito em dias],O.Transit_Time_Maximo AS [Trânsito máximo em dias]',
   oferta,'O.IdOferta_Frete'],
 escalas: ['Escalas e transbordos','O.Numero_Oferta AS Oferta,A.Nome AS [Porto ou aeroporto],C.Nome AS Transportadora,N.Nome AS Navio,T.Numero_Viagem_Voo AS [Viagem ou voo],T.Observacao AS [Observação]',
   `${porOferta('mov_Oferta_Frete_Escala_Transbordo')} LEFT JOIN cad_Origem_Destino A ON A.IdOrigem_Destino=T.IdPorto_Aeroporto
   ${pessoa('T.IdCompanhia_Transporte')} LEFT JOIN cad_Navio N ON N.IdNavio=T.IdNavio`,'O.IdOferta_Frete,T.Precedencia,T.IdOferta_Frete_Escala_Transb'],
 servicos: ['Serviços','O.Numero_Oferta AS Oferta,S.Nome AS [Serviço],T.Transit_Time AS [Trânsito em dias],T.Selecionado,T.Observacao AS [Observação]',
   `${porOferta('mov_Oferta_Frete_Servico_Maritimo')} LEFT JOIN mov_Servico_Maritimo S ON S.IdServico_Maritimo=T.IdServico_Maritimo`,'O.IdOferta_Frete,T.IdOferta_Frete_Servico_Maritimo'],
 detention: ['Tarifas detention', 'O.Numero_Oferta AS Oferta,E.Descricao AS Equipamento,T.Periodo AS [Período],T.Quantidade_Dias AS Dias,T.Valor_Unitario AS [Valor unitário],T.Observacao AS [Observação]',
   `${porOferta('mov_Oferta_Frete_Demurrage_Tarifa')} LEFT JOIN cad_Equipamento_Maritimo E ON E.IdEquipamento_Maritimo=T.IdEquipamento_Maritimo`, 'T.IdOferta_Frete_Demurrage_Tarifa'],
 condicoes: ['Condições', 'O.Numero_Oferta AS Oferta,G.Descricao AS Grupo,C.Descricao AS [Condição],T.Detalhamento,T.Observacao AS [Observação]',
 `${porOferta('mov_Oferta_Frete_Condicao')} LEFT JOIN cad_Condicao_Oferta C ON C.IdCondicao_Oferta=T.IdCondicao_Oferta
 LEFT JOIN cad_Condicao_Oferta_Grupo G ON G.IdCondicao_Oferta_Grupo=T.IdCondicao_Oferta_Grupo`, 'T.IdOferta_Frete_Condicao'],
 instrucoes: ['Instruções', 'O.Numero_Oferta AS Oferta,O.Referencia_Cliente AS [Referência do cliente],O.Instrucoes_Operacional AS [Operação],O.Instrucoes_Cliente AS Cliente,O.Instrucoes_Agente AS Agente,O.Remarks,O.Observacao AS [Observação]',
 oferta, 'O.IdOferta_Frete'],
 freeTime: ['Free time', 'O.Numero_Oferta AS Oferta,E.Descricao AS Equipamento,T.Master_Origem AS [Master na origem],T.House_Origem AS [House na origem],T.Master_Destino AS [Master no destino],T.House_Destino AS [House no destino],T.Observacao AS [Observação]',
 `${porOferta('mov_Oferta_Frete_Free_Time')} LEFT JOIN cad_Equipamento_Maritimo E ON E.IdEquipamento_Maritimo=T.IdEquipamento_Maritimo`, 'T.IdOferta_Frete_Free_Time'],
 comissoes: ['Comissões', 'O.Numero_Oferta AS Oferta,C.Nome AS Comissionado,M.Sigla AS Moeda,T.Valor_Comissao AS [Valor da comissão],T.Valor_Minimo AS [Valor mínimo]',
 `${porOferta('mov_Oferta_Frete_Comissao')} ${pessoa('T.IdPessoa')} LEFT JOIN cad_Moeda M ON M.IdMoeda=T.IdMoeda`, 'T.IdOferta_Frete_Comissao', 'AND ISNULL(T.Acesso_Restrito,0)=0'],
 taxas: ['Taxas', 'O.Numero_Oferta AS Oferta,E.Nome AS Taxa,MP.Sigla AS [Moeda do pagamento],T.Valor_Pagamento_Total AS Pagamento,MR.Sigla AS [Moeda do recebimento],T.Valor_Recebimento_Total AS Recebimento',
 `${porOferta('mov_Oferta_Frete_Taxa')} LEFT JOIN cad_Taxa_Logistica_Exibicao E ON E.IdTaxa_Logistica_Exibicao=T.IdTaxa_Logistica_Exibicao
 LEFT JOIN cad_Moeda MP ON MP.IdMoeda=T.IdMoeda_Pagamento LEFT JOIN cad_Moeda MR ON MR.IdMoeda=T.IdMoeda_Recebimento`, 'O.IdOferta_Frete,E.Nome,T.IdOferta_Frete_Taxa', 'AND ISNULL(T.Restrita,0)=0'],
 fechamento: ['Fechamento', 'O.Numero_Oferta AS Oferta,M.Sigla AS Moeda,T.Total_Pagamento AS [Total de pagamento],T.Total_Recebimento AS [Total de recebimento],T.Lucro_Estimado AS [Lucro estimado]',
 `${porOferta('mov_Oferta_Frete_Fechamento')} LEFT JOIN cad_Moeda M ON M.IdMoeda=T.IdMoeda`, 'T.IdOferta_Frete_Fechamento'],
 processos: ['Processos gerados', 'H.Numero_Processo AS Processo,O.Numero_Oferta AS Oferta,C.Nome AS Cliente,H.Data_Abertura_Processo AS Abertura',
 `FROM mov_Logistica_House H JOIN mov_Oferta_Frete O ON H.IdOferta_Frete=O.IdOferta_Frete ${pessoa('H.IdCliente')}`, 'H.IdLogistica_House DESC',
 `AND (@admin=1 OR (H.Numero_Processo NOT LIKE '% teste' AND H.Numero_Processo LIKE @modal+'%' AND
 (EXISTS(SELECT 1 FROM mov_Projeto_Atividade_Responsavel R WHERE R.IdProjeto_Atividade=H.IdProjeto_Atividade AND R.IdResponsavel=@pessoa)
 OR EXISTS(SELECT 1 FROM mov_Atividade A WHERE A.IdProjeto_Atividade=H.IdProjeto_Atividade AND A.IdResponsavel=@pessoa))))`],
};
const carga = ['Carga', 'L.Descricao AS [Descrição],L.Quantidade_Volumes AS Volumes,L.Peso_Bruto AS [Peso bruto],L.Peso_Taxado AS [Peso taxado],L.Metros_Cubicos AS [Volume (m³)],L.Equipamentos,L.NCM_Descricao AS NCM,L.Carga_Perigosa AS [Carga perigosa],L.Observacao AS [Observação]',
 'FROM mov_Proposta_Frete_Carga L', 'L.Indice,L.IdProposta_Frete_Carga'];
const atividades = ['Atividades', `T.Codigo AS [Código],T.Descricao AS Atividade,C.Nome AS [Responsável], A.Previsao_Termino AS [Prazo],A.Data_Termino AS [Conclusão],
 CASE A.Situacao WHEN 0 THEN 'Ainda não iniciada' WHEN 1 THEN 'Ainda não iniciada' WHEN 2 THEN 'Em andamento' WHEN 3 THEN 'Em espera' WHEN 4 THEN 'Concluída' WHEN 5 THEN 'Não realizada' WHEN 6 THEN 'Cancelada' END AS [Situação]`,
 `FROM mov_Atividade A LEFT JOIN cad_Tarefa T ON T.IdTarefa=A.IdTarefa ${pessoa('A.IdResponsavel')}`, 'T.Codigo,A.IdAtividade'];
const projeto = {
 atividades,
 acompanhamentos:['Acompanhamentos','A.Data,A.Titulo AS [Título],A.Descricao AS [Descrição],C.Nome AS [Responsável],A.Data_Retorno AS Retorno',
   `FROM mov_Acompanhamento A ${pessoa('A.IdResponsavel')}`,'A.Data DESC,A.IdAcompanhamento DESC'],
 mensagens:['Mensagens','M.Assunto,M.Remetente_Email AS Remetente,M.Data_Envio AS [Enviada em],M.Ativo',
   'FROM mov_Projeto_Atividade_Mensagem A JOIN mov_Mensagem M ON M.IdMensagem=A.IdMensagem','M.Data_Envio DESC,M.IdMensagem DESC','AND ISNULL(M.Excluida,0)=0'],
 arquivos:['Arquivos','F.Nome AS Arquivo,F.Descricao AS [Descrição],G.Nome AS Grupo,F.Data_Arquivo AS Data,F.Ativo',
   'FROM mov_Projeto_Atividade_Arquivo A JOIN arq_Arquivo F ON F.IdArquivo=A.IdArquivo LEFT JOIN cad_Arquivo_Grupo G ON G.IdArquivo_Grupo=F.IdArquivo_Grupo','F.Data_Arquivo DESC,F.IdArquivo DESC'],
 contatosProjeto:['Contatos vinculados','C.Nome AS Contato,C.EMail AS [E-mail],C.Fone AS Telefone,A.Observacao AS [Observação]',
   'FROM mov_Projeto_Atividade_Contato A JOIN cad_Pessoa_Contato C ON C.IdPessoa_Contato=A.IdPessoa_Contato','C.Nome,A.IdProjeto_Atividade_Contato'],
};

export async function consultarComercial(pool, pedido, {admin=false,pessoa:usuario,modalidade='',semComercial=false,semComissao=false}={}) {
 const {acao, busca='', pagina=0, numero, secao, estado=0}=pedido;
 if (!admin && semComercial) throw new FalhaPonte('Sua conta não tem acesso ao Comercial.',403);
 if (!admin && (!Number.isSafeInteger(usuario) || usuario<=0)) throw new FalhaPonte('Conta sem vínculo comercial.',403);
 if (acao==='mapa') return {modulos:mapaComercialWeb()};
 if (typeof busca!=='string'||busca.length>120||!Number.isSafeInteger(pagina)||pagina<0||pagina>20000||
     !Number.isInteger(estado)||estado<0||estado>6) throw new FalhaPonte('Filtro inválido.');
 const req = () => pool.request().input('admin',sql.Bit,admin).input('pessoa',sql.Int,usuario||0)
   .input('modal',sql.VarChar(8),modalidade).input('offset',sql.Int,pagina*30)
   .input('transporte',sql.Int,modalidade[1]==='A'?1:modalidade[1]==='M'?2:0)
   .input('operacao',sql.Int,modalidade[0]==='E'?1:modalidade[0]==='I'?2:0);
 const pesquisa = () => req().input('busca',sql.NVarChar(400),'%'+busca.trim().replace(/[\[\]%_]/g,c=>`[${c}]`)+'%');
 const paginar = r => ({linhas:r.recordset.slice(0,30),temMais:r.recordset.length>30});
 const lote = 'OFFSET @offset ROWS FETCH NEXT 31 ROWS ONLY';
 const comSituacao = linha => ({...linha,Situacao:situacao[linha.Situacao]||'Não informada'});
 if (acao==='configuracao') return {tarifarios:admin?Object.entries(tarifarios).map(([id,[nome]])=>({id,nome})):[]};
 if (acao==='tarifarioDetalhe') {
   if (!admin) throw new FalhaPonte('Consulta restrita à administração do Maicon.',403);
   if (!Object.hasOwn(tarifarios,secao)||!Number.isSafeInteger(pedido.id)||pedido.id<=0||pedido.id>2147483647)
     throw new FalhaPonte('Tarifário inválido.');
   const consulta=req().input('id',sql.Int,pedido.id);
   if (secao==='demurrage') return paginar(await consulta.query(`
     SELECT E.Descricao AS Equipamento,T.Periodo AS [Período],T.Quantidade_Dias AS Dias,
       M.Sigla AS Moeda,T.Valor_Unitario AS [Valor unitário],T.Observacao AS [Observação]
     FROM mov_Tarifario_Demurrage_Taxa T JOIN mov_Tarifario_Demurrage D ON D.IdTarifario_Demurrage=T.IdTarifario_Demurrage
     LEFT JOIN cad_Equipamento_Maritimo E ON E.IdEquipamento_Maritimo=T.IdEquipamento_Maritimo
     LEFT JOIN cad_Moeda M ON M.IdMoeda=D.IdMoeda
     WHERE T.IdTarifario_Demurrage=@id ORDER BY T.IdTarifario_Demurrage_Taxa ${lote}`));
   const [tabela,filtro,ordem]=taxasTarifario[secao];
   return paginar(await consulta.query(`
     SELECT L.Nome AS Taxa,MP.Sigla AS [Moeda do pagamento],T.Valor_Pagamento_Unitario AS [Pagamento unitário],
       MR.Sigla AS [Moeda do recebimento],T.Valor_Recebimento_Unitario AS [Recebimento unitário],T.Observacao AS [Observação]
     FROM ${tabela} T LEFT JOIN cad_Taxa_Logistica L ON L.IdTaxa_Logistica=T.IdTaxa_Logistica
     LEFT JOIN cad_Moeda MP ON MP.IdMoeda=T.IdMoeda_Pagamento LEFT JOIN cad_Moeda MR ON MR.IdMoeda=T.IdMoeda_Recebimento
     WHERE ${filtro} ORDER BY L.Nome,${ordem} ${lote}`));
 }
 if (acao==='tarifario' || acao==='contratos') {
   if (!admin) throw new FalhaPonte('Consulta restrita à administração do Maicon.',403);
   if (acao==='contratos') return paginar(await pesquisa().query(`
     SELECT T.Numero_Contrato AS Contrato,C.Nome AS [Empresa],T.Data_Contrato AS Data,T.Ativo,T.Observacao AS [Observação]
     FROM mov_Contrato_Frete T ${pessoa('T.IdPessoa_Contrato')}
     WHERE C.Nome LIKE @busca OR T.Numero_Contrato LIKE @busca ORDER BY T.IdContrato_Frete DESC ${lote}`));
   const spec = Object.hasOwn(tarifarios,secao)?tarifarios[secao]:null;
   if (!spec) throw new FalhaPonte('Tarifário inválido.');
   const [,tabela,id,codigo,empresa,fim,origem,destino]=spec;
   const locais=origem?`A.Nome AS Origem,B.Nome AS Destino,`:'';
   return paginar(await pesquisa().query(`
     SELECT T.${id} AS [chave],${codigo==='NULL'?'':codigo+' AS [Número],'} C.Nome AS [Transportadora ou parceiro],${locais}
     T.Data_Inicio_Vigencia AS [Início da vigência],${fim} AS [Válido até],T.Observacao AS [Observação]
     FROM ${tabela} T ${pessoa(empresa)} ${origem?rota(origem,destino):''}
     WHERE C.Nome LIKE @busca OR COALESCE(CONVERT(nvarchar(100),${codigo}),'') LIKE @busca
     ${origem?'OR A.Nome LIKE @busca OR B.Nome LIKE @busca':''}
     ORDER BY ${fim} DESC,T.${id} DESC ${lote}`));
 }
 if (acao==='propostas' || acao==='ofertas') {
   const listarOfertas=acao==='ofertas';
   const r = await pesquisa().input('estado',sql.Int,estado).query(`
     SELECT P.IdProposta_Frete AS [chave],${campos},P.Numero_Versao AS [Versão]${listarOfertas?',O.Numero_Oferta AS Oferta,A.Nome AS Origem,B.Nome AS Destino,O.Data_Validade AS [Válida até]':''}
     ${proposta} ${listarOfertas?`JOIN mov_Oferta_Frete O ON O.IdProposta_Frete=P.IdProposta_Frete ${rota('O.IdOrigem','O.IdDestino')}`:''}
     WHERE ${escopo} AND (@estado=0 OR P.Situacao=@estado)
       ${listarOfertas?`AND ${recorteOferta('O')}`:''}
       AND (P.Numero_Proposta LIKE @busca OR C.Nome LIKE @busca ${listarOfertas?'OR O.Numero_Oferta LIKE @busca OR A.Nome LIKE @busca OR B.Nome LIKE @busca':
       `OR EXISTS(SELECT 1 FROM mov_Oferta_Frete M WHERE M.IdProposta_Frete=P.IdProposta_Frete AND M.Numero_Oferta LIKE @busca AND ${recorteOferta('M')})`})
     ORDER BY P.Data_Proposta DESC,P.IdProposta_Frete DESC${listarOfertas?',O.IdOferta_Frete DESC':''} ${lote}`);
   return {...paginar(r),linhas:r.recordset.slice(0,30).map(comSituacao)};
 }
 if (!['proposta','secao','baseRascunho','camposEdicao'].includes(acao) || typeof numero!=='string' || !numero.trim() || numero.length>50)
   throw new FalhaPonte('Informe uma proposta válida.');
 const chave=pedido.chave??0;
 if(!Number.isSafeInteger(chave)||chave<0||chave>2147483647)throw new FalhaPonte('Versão de proposta inválida.');
 const r = await req().input('numero',sql.VarChar(50),numero).input('chave',sql.Int,chave).query(`
   SELECT TOP 1 ${campos},P.IdProposta_Frete,P.IdProjeto_Atividade,P.Numero_Versao AS [Versão],P.Data_Aprovacao AS [Aprovação],
   V.Nome AS Vendedor,R.Nome AS [Responsável],P.Observacao AS [Observação],P.Data_Versao AS [Data da versão],
   P.Data_Solicitacao_Cliente AS [Solicitação do cliente],P.Detalhes_Nao_Aprovacao AS [Detalhes da não aprovação]
   ${proposta} LEFT JOIN cad_Pessoa V ON V.IdPessoa=P.IdVendedor LEFT JOIN cad_Pessoa R ON R.IdPessoa=P.IdResponsavel
   WHERE P.Numero_Proposta=@numero AND (@chave=0 OR P.IdProposta_Frete=@chave)
     AND ${escopo} ORDER BY P.Numero_Versao DESC,P.IdProposta_Frete DESC`);
 const registro=r.recordset[0];
 if (!registro) throw new FalhaPonte('Proposta não encontrada ou sem acesso para sua conta.',404);
 const {IdProposta_Frete,IdProjeto_Atividade,...dados}=registro;
 if (acao==='camposEdicao') {
   if (!chave) throw new FalhaPonte('Selecione a versão da proposta antes de preparar alterações.');
   return prepararCamposProposta(req,pedido,registro,recorteOferta('O'));
 }
 if (acao==='baseRascunho') {
   const origem = ofertas.ofertas[2];
   const filtro = `O.IdProposta_Frete=@id AND ${recorteOferta('O')} AND ISNULL(O.Ativo,1)=1`;
   const consulta = () => req().input('id',sql.Int,IdProposta_Frete);
   const [ofertasAtivas, valores] = await Promise.all([
     consulta().query(`SELECT TOP 31 ${ofertas.ofertas[1]} ${origem} WHERE ${filtro} ORDER BY O.IdOferta_Frete DESC`),
     consulta().query(`SELECT TOP 101 O.Numero_Oferta AS Oferta,E.Nome AS Taxa,M.Sigla AS Moeda,T.Valor_Recebimento_Total AS Valor
       ${porOferta('mov_Oferta_Frete_Taxa')}
       LEFT JOIN cad_Taxa_Logistica_Exibicao E ON E.IdTaxa_Logistica_Exibicao=T.IdTaxa_Logistica_Exibicao
       LEFT JOIN cad_Moeda M ON M.IdMoeda=T.IdMoeda_Recebimento
       WHERE ${filtro} AND ISNULL(T.Restrita,0)=0 AND T.Exibir_Cliente=1 ORDER BY O.IdOferta_Frete,E.Nome,T.IdOferta_Frete_Taxa`),
   ]);
   if (ofertasAtivas.recordset.length>30 || valores.recordset.length>100) {
     throw new FalhaPonte('Esta versão tem mais ofertas ou taxas do que cabem no rascunho. Use o briefing para preparar o texto de uma oferta específica.',422);
   }
   return {proposta:dados.Proposta, cliente:dados.Cliente, versao:dados['Versão'],
     ofertas:ofertasAtivas.recordset, taxas:valores.recordset};
 }
 const secoes={ofertas:ofertas.ofertas,carga,viagens:ofertas.viagens,condicoes:ofertas.condicoes,
   instrucoes:ofertas.instrucoes,freeTime:ofertas.freeTime,processos:ofertas.processos,
   contatos:ofertas.contatos,informacoes:ofertas.informacoes,remarks:ofertas.remarks,adicionais:ofertas.adicionais,
   embarqueClassico:ofertas.ofertas,coletaEntrega:ofertas.coletaEntrega,complemento:ofertas.complemento,escalas:ofertas.escalas,servicos:ofertas.servicos,
   ...projeto,
   ...(admin?{taxas:ofertas.taxas,fechamento:ofertas.fechamento,detention:ofertas.detention}:{}),
   ...(admin&&!semComissao?{comissoes:ofertas.comissoes}:{})};
 if (acao==='proposta') return {dados:comSituacao(dados),secoes:Object.entries(secoes).map(([id,[nome]])=>({id,nome}))};
 if (secao==='dadosProposta') return {linhas:[comSituacao(dados)],temMais:false};
 if (!Object.hasOwn(secoes,secao)) throw new FalhaPonte('Seção não disponível para sua conta.',403);
 const [,colunas,origem,ordem,filtro='']=secoes[secao];
 const vinculo=secao==='carga'?'L.IdProposta_Frete=@id':Object.hasOwn(projeto,secao)?'A.IdProjeto_Atividade=@projeto':
   `O.IdProposta_Frete=@id AND ${recorteOferta('O')}`;
 const resultado=paginar(await req().input('id',sql.Int,IdProposta_Frete).input('projeto',sql.Int,IdProjeto_Atividade)
   .query(`SELECT ${colunas} ${origem} WHERE ${vinculo} ${filtro} ORDER BY ${ordem} ${lote}`));
 if(secao==='adicionais') resultado.linhas=resultado.linhas.map(l=>({Oferta:l.Oferta,Campo:l.Campo,Valor:valorCampoLivre(l)}));
 return resultado;
}
