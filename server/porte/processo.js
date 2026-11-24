import sql from "mssql";
import { FalhaPonte } from "../ponte/sessoes.js";
const status = { 0: "Ainda não iniciada", 1: "Ainda não iniciada", 2: "Em andamento", 3: "Em espera", 4: "Concluída", 5: "Não realizada", 6: "Cancelada" };

export async function listarProcessosWeb(pool, {busca="",pagina=0}={}, {admin=false,pessoa,modalidade=""}={}) {
  if(typeof busca!=="string"||busca.length>120||!Number.isSafeInteger(pagina)||pagina<0||pagina>20000)throw new FalhaPonte("Filtro de processos inválido.");
  if(!admin&&(!Number.isSafeInteger(pessoa)||pessoa<=0))throw new FalhaPonte("Conta sem vínculo operacional.",403);
  const termo=busca.trim().replace(/[\[\]%_]/g,c=>`[${c}]`);
  const r=await pool.request().input("busca",sql.VarChar(250),`%${termo}%`).input("pessoa",sql.Int,pessoa||0).input("admin",sql.Bit,admin).input("modal",sql.VarChar(8),modalidade?`${modalidade}%`:"%").input("offset",sql.Int,pagina*50).query(`
    SELECT H.Numero_Processo AS Numero,C.Nome AS Cliente,H.Referencia_Cliente AS Referencia,S.Descricao AS Situacao,H.Data_Abertura_Processo AS Abertura
    FROM mov_Logistica_House H LEFT JOIN cad_Pessoa C ON C.IdPessoa=H.IdCliente
    LEFT JOIN cad_Status_Processo_Logistico S ON S.IdStatus_Processo_Logistico=H.IdStatus_Processo_Logistico
    WHERE (H.Numero_Processo LIKE @busca OR C.Nome LIKE @busca OR H.Referencia_Cliente LIKE @busca)
      AND (@admin=1 OR (H.Numero_Processo NOT LIKE '% teste' AND H.Numero_Processo LIKE @modal AND
        (EXISTS(SELECT 1 FROM mov_Projeto_Atividade_Responsavel R WHERE R.IdProjeto_Atividade=H.IdProjeto_Atividade AND R.IdResponsavel=@pessoa)
         OR EXISTS(SELECT 1 FROM mov_Atividade A WHERE A.IdProjeto_Atividade=H.IdProjeto_Atividade AND A.IdResponsavel=@pessoa))))
    ORDER BY H.Data_Abertura_Processo DESC,H.IdLogistica_House DESC OFFSET @offset ROWS FETCH NEXT 51 ROWS ONLY`);
  return {linhas:r.recordset.slice(0,50),temMais:r.recordset.length>50,pagina};
}

export async function processoAutorizado(pool, numero, { admin = false, pessoa, modalidade = "" } = {}) {
  if (typeof numero !== "string" || !/^[A-Za-z]{1,4}\d{2,6}-\d{2}( teste)?$/i.test(numero.trim())) throw new FalhaPonte("Informe um número de processo válido.");
  numero = numero.trim();
  if (!admin && (/ teste$/i.test(numero) || !Number.isSafeInteger(pessoa) || pessoa <= 0)) throw new FalhaPonte("Este processo não está disponível para sua conta.",403);
  if (!admin && modalidade && !numero.toUpperCase().startsWith(modalidade)) throw new FalhaPonte("Processo fora da modalidade permitida.",403);
  const request = () => pool.request().input("numero",sql.VarChar(40),numero).input("pessoa",sql.Int,pessoa || 0).input("admin",sql.Bit,admin);
  const r = await request().query(`
    SELECT TOP 2 H.IdLogistica_House, H.IdLogistica_Master, H.IdProjeto_Atividade, H.IdOferta_Frete, H.Numero_Processo, H.Referencia_Cliente,
      H.Data_Abertura_Processo, C.Nome AS Cliente, S.Descricao AS Situacao
    FROM mov_Logistica_House H
    LEFT JOIN cad_Pessoa C ON C.IdPessoa = H.IdCliente
    LEFT JOIN cad_Status_Processo_Logistico S ON S.IdStatus_Processo_Logistico = H.IdStatus_Processo_Logistico
    WHERE H.Numero_Processo = @numero AND (@admin = 1
      OR EXISTS (SELECT 1 FROM mov_Projeto_Atividade_Responsavel R WHERE R.IdProjeto_Atividade = H.IdProjeto_Atividade AND R.IdResponsavel = @pessoa)
      OR EXISTS (SELECT 1 FROM mov_Atividade A WHERE A.IdProjeto_Atividade = H.IdProjeto_Atividade AND A.IdResponsavel = @pessoa))`);
  if (r.recordset.length !== 1) throw new FalhaPonte("Processo não encontrado ou sem acesso para sua conta.",404);
  return r.recordset[0];
}

export async function consultarProcessoWeb(pool, numero, contexto = {}) {
  const h = await processoAutorizado(pool, numero, contexto);
  const atividades = await pool.request().input("projeto",sql.Int,h.IdProjeto_Atividade).query(`
    SELECT A.IdAtividade, T.Codigo, T.Descricao AS Atividade, A.Situacao, P.Nome AS Responsavel,
      A.Previsao_Inicio, A.Previsao_Termino, A.Data_Inicio, A.Data_Termino
    FROM mov_Atividade A
    LEFT JOIN cad_Tarefa T ON T.IdTarefa = A.IdTarefa
    LEFT JOIN cad_Pessoa P ON P.IdPessoa = A.IdResponsavel
    WHERE A.IdProjeto_Atividade = @projeto
    ORDER BY A.Previsao_Termino, T.Codigo, A.IdAtividade`);
  return { numero: h.Numero_Processo, cliente: h.Cliente, referencia: h.Referencia_Cliente, situacao: h.Situacao, abertura: h.Data_Abertura_Processo,
    atividades: atividades.recordset.map(a => ({ ...a, SituacaoTexto: status[a.Situacao] || `Situação ${a.Situacao}` })), modo: "somente-leitura" };
}
