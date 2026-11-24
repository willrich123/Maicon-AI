import sql from "mssql";
import { FalhaPonte } from "./sessoes.js";

export async function usuarioPonteDaConta(pool, conta) {
  // Vínculo pelo e-mail autenticado. Nunca aceitar login/IdUsuario do navegador
  // nem inferir identidade somente pelo nome antes do @ de um e-mail externo.
  const email = String(conta?.email || "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 180) throw new FalhaPonte("Conta Maicon inválida.", 401);
  const r = await pool.request().input("email", sql.VarChar(180), email).query(`
    SELECT DISTINCT TOP 2 U.IdUsuario, U.Nome AS Usuario, P.Nome AS Pessoa, P.IdPessoa
    FROM cad_Funcionario F
    JOIN cad_Pessoa P ON P.IdPessoa = F.IdPessoa
    JOIN sys_Usuario U ON U.IdUsuario = F.IdUsuario_Correspondente
    WHERE LOWER(LTRIM(RTRIM(ISNULL(P.EMail, '')))) = @email
       OR LOWER(LTRIM(RTRIM(ISNULL(P.EMail_Pessoal, '')))) = @email
       OR EXISTS (SELECT 1 FROM cad_Conta_Email C WHERE C.IdUsuario = U.IdUsuario
                  AND LOWER(LTRIM(RTRIM(ISNULL(C.EMail, '')))) = @email)
  `);
  if (r.recordset.length !== 1 || !String(r.recordset[0].Usuario || "").trim()) throw new FalhaPonte("Não foi possível confirmar um vínculo único entre sua conta Maicon e o usuário do HeadCargo.", 403);
  return { email, nome: conta.nome || r.recordset[0].Pessoa, usuario: String(r.recordset[0].Usuario).trim(), idPessoa: Number(r.recordset[0].IdPessoa) };
}
