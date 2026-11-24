import sql from "mssql";
import { protegerPool } from "./seguranca.js";

export function criarPoolSql(destino, nome) {
  let poolFixo = null;
  let abrindo = null;

  async function abrir() {
    const { servidor, banco, usuario, senha, instancia, porta } = destino();
    if (!servidor || !banco || !usuario || !senha) {
      throw new Error(`Configure servidor, banco e credenciais para consultar ${nome}.`);
    }
    const pool = new sql.ConnectionPool({
      server: instancia ? `${servidor.trim()}\\${instancia.trim()}` : servidor.trim(),
      port: Number(porta || 1433),
      database: banco.trim(),
      user: usuario.trim(),
      password: senha,
      options: {
        encrypt: process.env.SQL_ENCRYPT !== "false",
        trustServerCertificate: process.env.SQL_TRUST_CERT !== "false",
        enableArithAbort: true,
        readOnlyIntent: true,
      },
      requestTimeout: 180000,
      connectionTimeout: 15000,
    });
    await pool.connect();
    const encerrar = pool.close.bind(pool);
    const protegido = protegerPool(pool);
    protegido.encerrar = encerrar;
    protegido.close = () => Promise.resolve();
    protegido.on("error", () => {
      if (poolFixo === protegido) poolFixo = null;
      encerrar().catch(() => {});
    });
    return protegido;
  }

  return {
    conectar() {
      if (poolFixo?.connected) return Promise.resolve(poolFixo);
      if (!abrindo) {
        const anterior = poolFixo;
        poolFixo = null;
        if (anterior) void anterior.encerrar().catch(() => {});
        abrindo = abrir().then(pool => {
          poolFixo = pool;
          return pool;
        }).finally(() => { abrindo = null; });
      }
      return abrindo;
    },
    async renovar(falhou) {
      if (poolFixo !== falhou) return;
      poolFixo = null;
      await falhou.encerrar().catch(() => {});
    },
  };
}
