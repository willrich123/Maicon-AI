import test from "node:test";
import assert from "node:assert/strict";
import { modeloGoogle, pedidoGoogle, partesGoogle, urlGoogle, lerStreamGoogle } from "../server/google.js";

test('assinatura de ferramenta do Gemini sobrevive ao ciclo de resposta e novo pedido',()=>{
 const resposta=partesGoogle({content:{parts:[{functionCall:{id:'c1',name:'andamento_atividade',args:{numero:'IM2099-25 teste'}},thoughtSignature:'assinatura-opaca-de-teste'}]}});
 assert.equal(resposta.tools[0].extra_content.google.thought_signature,'assinatura-opaca-de-teste');
 const p=pedidoGoogle({messages:[{role:'user',content:'Consulte'},{role:'assistant',content:'',tool_calls:JSON.parse(JSON.stringify(resposta.tools))},{role:'tool',tool_call_id:'c1',name:'andamento_atividade',content:'{}'}]});
 assert.equal(p.contents[1].parts[0].thoughtSignature,'assinatura-opaca-de-teste');assert.equal(p.contents[1].parts[0].functionCall.name,'andamento_atividade');
 const compat=pedidoGoogle({messages:[{role:'assistant',tool_calls:[{id:'c2',function:{name:'resumo_processo',arguments:'{}'},extra_content:{google:{thought_signature:'compat-teste'}}}]}]});
 assert.equal(compat.contents.find(c=>c.role==='model').parts[0].thoughtSignature,'compat-teste');
});

test('assinatura recebida em streaming permanece no próximo pedido',async()=>{
 const texto='data: '+JSON.stringify({candidates:[{content:{parts:[{functionCall:{name:'andamento_atividade',args:{}},thoughtSignature:'stream-opaco'}]}}]})+'\n\n';
 const bytes=new TextEncoder().encode(texto);const stream=new ReadableStream({start(c){c.enqueue(bytes.slice(0,47));c.enqueue(bytes.slice(47));c.close();}});
 const r=await lerStreamGoogle(stream,()=>{});assert.equal(r.tool_calls[0].thoughtSignature,'stream-opaco');
 const p=pedidoGoogle({messages:[{role:'assistant',...r}]});assert.equal(p.contents.find(c=>c.role==='model').parts[0].thoughtSignature,'stream-opaco');
});

test("o chat usa só o Gemini 3.5 Flash-Lite", () => {
  assert.equal(modeloGoogle(), "gemini-3.5-flash-lite");
  assert.equal(modeloGoogle("gemma-4-26b-a4b-it"), "gemini-3.5-flash-lite");
  assert.equal(modeloGoogle(""), "gemini-3.5-flash-lite");
  assert.equal(
    urlGoogle("gemini-3.5-flash-lite", "stream"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse",
  );
});

test("o pedido do chat vira a API nativa do Gemma, com ferramenta obrigatória", () => {
  const pedido = pedidoGoogle({
    temperature: 0.3,
    max_tokens: 400,
    tool_choice: "required",
    tools: [{
      type: "function",
      function: {
        name: "executar_sql",
        description: "Consulta o banco",
        parameters: {
          type: "object",
          properties: { sql: { type: "string" } },
          required: ["sql"],
        },
      },
    }],
    messages: [
      { role: "system", content: "Responda em português." },
      { role: "user", content: "Quantos processos hoje?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "executar_sql", arguments: "{\"sql\":\"select 1\"}" },
        }],
      },
      { role: "tool", name: "executar_sql", tool_call_id: "call_1", content: "{\"linhas\":1}" },
    ],
  });
  assert.equal(pedido.systemInstruction, undefined);
  assert.equal(pedido.contents[0].parts[0].text, "Responda em português.");
  assert.equal(pedido.contents[0].role, "user");
  assert.equal(pedido.contents[1].role, "model");
  assert.equal(pedido.contents[1].parts[0].functionCall.name, "executar_sql");
  assert.deepEqual(pedido.contents[1].parts[0].functionCall.args, { sql: "select 1" });
  assert.equal(pedido.contents[2].parts[0].functionResponse.name, "executar_sql");
  assert.equal(pedido.tools[0].functionDeclarations[0].parameters.type, "OBJECT");
  assert.equal(pedido.tools[0].functionDeclarations[0].parameters.properties.sql.type, "STRING");
  assert.equal(pedido.toolConfig, undefined);
  assert.equal(pedido.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.equal(pedido.generationConfig.maxOutputTokens, 400);
});

test("a resposta do Gemma devolve texto e chamada de ferramenta", () => {
  const mensagem = partesGoogle({
    content: {
      parts: [
        { text: "pensando", thought: true },
        { text: "Achei 3." },
        { functionCall: { id: "abc", name: "executar_sql", args: { sql: "select 1" } } },
      ],
    },
  });
  assert.equal(mensagem.content, "Achei 3.");
  assert.equal(mensagem.reasoning, "pensando");
  assert.equal(mensagem.tools[0].id, "abc");
  assert.equal(mensagem.tools[0].function.name, "executar_sql");
  assert.equal(mensagem.tools[0].function.arguments, "{\"sql\":\"select 1\"}");
});

test("enum numérico da ferramenta vai como texto para o Google", () => {
  const pedido = pedidoGoogle({
    messages: [{ role: "user", content: "Quem gravou log?" }],
    tools: [{
      type: "function",
      function: {
        name: "consultar_log",
        description: "Histórico",
        parameters: {
          type: "object",
          properties: {
            tipo: { type: "integer", enum: [0, 1, 2, 3] },
          },
        },
      },
    }],
  });
  const tipo = pedido.tools[0].functionDeclarations[0].parameters.properties.tipo;
  assert.equal(tipo.type, "INTEGER");
  assert.deepEqual(tipo.enum, ["0", "1", "2", "3"]);
});
