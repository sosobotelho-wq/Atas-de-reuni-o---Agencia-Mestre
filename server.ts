import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import "dotenv/config";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));

// Initialize GoogleGenAI SDK lazily as recommended
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in the environment secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Proxy endpoint for the official Agência Mestre logo with robust SVG layout
app.get("/api/mestre-logo.png", (req, res) => {
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 100" width="450" height="100"><g transform="translate(10, 15)"><path d="M15,45 L25,15 L40,30 L55,15 L65,45 Z" fill="#0b1b3d" stroke="#0b1b3d" stroke-width="4" stroke-linejoin="round"/><circle cx="15" cy="12" r="3" fill="#0b1b3d"/><circle cx="40" cy="27" r="3" fill="#0b1b3d"/><circle cx="65" cy="12" r="3" fill="#0b1b3d"/><path d="M10,50 L70,50 L65,58 L15,58 Z" fill="#FFC90E"/></g><text x="100" y="60" font-family="'Inter', sans-serif" font-size="36" font-weight="900" fill="#0b1b3d" letter-spacing="1">MESTRE</text><text x="100" y="80" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="#9CA3AF" letter-spacing="3.5">AGÊNCIA DE MARKETING DIGITAL</text></svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(fallbackSvg);
});// JSON endpoint providing base64 encoded logo for full standalone exports and Google Docs copy pasting with SVG fallback
app.get("/api/mestre-logo-base64", (req, res) => {
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 100" width="450" height="100"><g transform="translate(10, 15)"><path d="M15,45 L25,15 L40,30 L55,15 L65,45 Z" fill="#0b1b3d" stroke="#0b1b3d" stroke-width="4" stroke-linejoin="round"/><circle cx="15" cy="12" r="3" fill="#0b1b3d"/><circle cx="40" cy="27" r="3" fill="#0b1b3d"/><circle cx="65" cy="12" r="3" fill="#0b1b3d"/><path d="M10,50 L70,50 L65,58 L15,58 Z" fill="#FFC90E"/></g><text x="100" y="60" font-family="'Inter', sans-serif" font-size="36" font-weight="900" fill="#0b1b3d" letter-spacing="1">MESTRE</text><text x="100" y="80" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="#9CA3AF" letter-spacing="3.5">AGÊNCIA DE MARKETING DIGITAL</text></svg>`;
  const svgBase64 = Buffer.from(fallbackSvg).toString("base64");
  res.json({ base64: `data:image/svg+xml;base64,${svgBase64}` });
});

// Heuristic rule-based NLP parser in Portuguese for offline/quota recovery mode
function parseNotesFallback(notes: string): any {
  const currentDate = new Date();
  const day = String(currentDate.getDate()).padStart(2, "0");
  const month = String(currentDate.getMonth() + 1).padStart(2, "0");
  const year = currentDate.getFullYear();
  let dataReuniao = `${day}/${month}/${year}`;

  const lines = notes.split("\n").map(l => l.trim()).filter(Boolean);

  // 1. Extração de Data com expressões regulares
  const dateRegex = /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/;
  const dateMatch = notes.match(dateRegex);
  if (dateMatch) {
    let d = dateMatch[1].padStart(2, "0");
    let m = dateMatch[2].padStart(2, "0");
    let y = dateMatch[3];
    if (y.length === 2) y = "20" + y;
    dataReuniao = `${d}/${m}/${y}`;
  }

  // 2. Extração de Participantes
  let participantes: string[] = [];
  
  // Buscar linhas contendo identificadores de participantes
  for (const line of lines) {
    if (/^(participantes|presentes|quem|integrantes|membros|equipe)\s*:/i.test(line)) {
      const content = line.replace(/^(participantes|presentes|quem|integrantes|membros|equipe)\s*:/i, "").trim();
      const parts = content.split(/[\s,;]+/).map(p => p.trim());
      participantes.push(...parts);
    }
  }

  // Se não foi explicitamente encontrado via prefixo, busca palavras capituladas em formato de lista simples
  if (participantes.length === 0) {
    for (const line of lines) {
      if (/^[-*•]\s*([A-Z][a-z]+)(\s+[A-Z][a-z]+)*$/g.test(line)) {
        const cleanName = line.replace(/^[-*•]\s*/, "").trim();
        participantes.push(cleanName);
      }
    }
  }

  // Se ainda estiver vazia, faz o escaneamento de nomes próprios comuns nas anotações
  if (participantes.length === 0) {
    const knownNames = ["Sofia", "Ana", "Pedro", "Felipe", "Gustavo", "Mariana", "Lucas", "Julia", "Matheus", "Beatriz"];
    for (const name of knownNames) {
      if (new RegExp("\\b" + name + "\\b", "i").test(notes)) {
        participantes.push(name);
      }
    }
  }

  // Limpeza fina dos nomes (Sempre mantendo estritamente apenas o primeiro nome)
  participantes = participantes
    .map(p => {
      const clean = p.replace(/[.,:;()\[\]]/g, "").trim();
      return clean.split(/\s+/)[0];
    })
    .filter(p => !/^(e|da|do|de|com|mestre|seo|agência|presentes|participantes)$/i.test(p) && p.length > 2 && /^[a-zA-ZÀ-ÿ]+$/.test(p));

  // Remover nomes duplicados
  participantes = Array.from(new Set(participantes));

  if (participantes.length === 0) {
    participantes = ["Sofia", "Pedro", "Ana"];
  }

  // 3. Extração inovadora da Pauta (Agenda)
  let pauta = "Acompanhamento estratégico e alinhamento de prioridades para o projeto marketing.";
  for (const line of lines) {
    if (/^(pauta|agenda|assunto|temas|objetivo)\s*:/i.test(line)) {
      const content = line.replace(/^(pauta|agenda|assunto|temas|objetivo)\s*:/i, "").trim();
      if (content.length > 5) {
        pauta = content.replace(/[#*]/g, "").trim();
        break;
      }
    }
  }

  // 4. Extração de Próximos Passos
  let proximosPassos: string[] = [];
  let isCapturingSteps = false;

  for (const line of lines) {
    if (/^(próximos\s+passos|proximos\s+passos|pendências|acordo|ações|tarefas|to-do|to\s*do|ações\s+a\s+tomar)/i.test(line)) {
      isCapturingSteps = true;
      continue;
    }
    
    if (isCapturingSteps && /^(ata\s+da\s+reunião|ata|discussão|pauta|participantes|data|assunto|resumo):/i.test(line)) {
      isCapturingSteps = false;
    }

    if (isCapturingSteps) {
      const cleanLine = line.replace(/^[-*•\s\d\.]+\s*/, "").replace(/[#*]/g, "").trim();
      if (cleanLine && cleanLine.length > 4) {
        proximosPassos.push(cleanLine);
      }
    }
  }

  // Heurística secundária: Capturar bullet points que têm verbos no infinitivo comum de ações
  if (proximosPassos.length === 0) {
    const actionVerbs = /(criar|desenvolver|enviar|fazer|produzir|analisar|ajustar|configurar|validar|definir|revisar|organizar|implementar|corrigir)/i;
    for (const line of lines) {
      if ((line.startsWith("-") || line.startsWith("*") || line.startsWith("•")) && actionVerbs.test(line)) {
        const cleanLine = line.replace(/^[-*•\s\d\.]+\s*/, "").replace(/[#*]/g, "").trim();
        if (cleanLine && cleanLine.length > 5) {
          proximosPassos.push(cleanLine);
        }
      }
    }
  }

  if (proximosPassos.length === 0) {
    proximosPassos = [
      "Fazer os ajustes acordados nas novas campanhas.",
      "Analisar o relatório mensal de indexações para a próxima semana.",
      "Encaminhar os resultados e o resumo da reunião para a equipe principal."
    ];
  } else {
    proximosPassos = proximosPassos.slice(0, 8); // Safe upper bound
  }

  // 5. Estruturação da Ata detalhada
  let rawAtaParagraphs: string[] = [];
  let activeParagraph = "";

  for (const line of lines) {
    // Pular linhas que parecem metadados ou listas de controle
    if (/^(data|participantes|presentes|pauta|proximos|próximos|agenda|assunto|tarefas|to-do|to\s*do|ações|quem|integrantes)\s*:/i.test(line)) {
      if (activeParagraph) {
        rawAtaParagraphs.push(activeParagraph);
        activeParagraph = "";
      }
      continue;
    }

    const clean = line.replace(/^[-*•\s\d\.]+\s*/, "").replace(/[#*]/g, "").trim();
    if (!clean || clean.length < 5) continue;

    if (activeParagraph) {
      if (clean.length > 60 && /^[A-Z]/.test(clean)) {
        rawAtaParagraphs.push(activeParagraph);
        activeParagraph = clean;
      } else {
        activeParagraph += " " + clean;
      }
    } else {
      activeParagraph = clean;
    }
  }

  if (activeParagraph) {
    rawAtaParagraphs.push(activeParagraph);
  }

  // Função auxiliar de limpeza fina
  const cleanLineFormatting = (text: string) => {
    return text.replace(/\[?\d{1,2}:\d{2}\]?/g, "")
               .replace(/\(?minuto\s+\d+\)?/gi, "")
               .replace(/\s\s+/g, " ")
               .trim();
  };

  rawAtaParagraphs = rawAtaParagraphs.map(cleanLineFormatting).filter(p => p.length > 10);

  if (rawAtaParagraphs.length === 0) {
    rawAtaParagraphs = [
      "A equipe realizou o acompanhamento sistemático de todas as prioridades vigentes e operacionais de marketing.",
      "Debatemos de forma abrangente as evoluções apresentadas e planejamos as entregas prioritárias especificadas pela liderança no projeto."
    ];
  }

  const ata_reuniao = rawAtaParagraphs.map(p => {
    const capped = p.charAt(0).toUpperCase() + p.slice(1);
    return capped.endsWith(".") || capped.endsWith("?") || capped.endsWith("!") ? capped : capped + ".";
  }).join("\n\n");

  // 6. Resumo Planilha sem marcações markdown
  const listItems = proximosPassos.map(step => `- ${step}`).join("\n");
  const resumo_planilha = `Na reunião, debatemos os rumos estratégicos, aprovando ideias de alteração e traçando correções necessárias no desenvolvimento.\n\nPróximos passos:\n${listItems}`;

  // 7. Resumo E-mail (Exatamente dois parágrafos amigáveis sem marcadores de markdown)
  const p1 = `Durante o nosso encontro de hoje, pudemos realizar o alinhamento essencial referente ao andamento geral das campanhas de marketing em execução. Compartilhamos o progresso obtido, respondendo as dúvidas pontuais levantadas e planejando novos incrementos de SEO.`;
  const p2 = `Definimos também os prazos finais para as demandas agendadas e estruturamos os devidos responsáveis das tarefas, o que proporcionará celeridade e acompanhamento claro das melhorias técnias planejadas.`;

  const intro = "Ei, pessoal! Tudo bem?\n\nMuito obrigada pela nossa reunião de hoje :)\n\nSegue, em anexo, a ata da nossa reunião.";
  const footer = "Qualquer coisa, ficamos à disposição!\n\nAbraços!";
  
  const resumo_email = `${intro}\n\n${p1}\n\n${p2}\n\n${footer}`;

  return {
    data_reuniao: dataReuniao,
    participantes,
    pauta,
    ata_reuniao,
    proximos_passos: proximosPassos,
    resumo_planilha,
    resumo_email,
    isFallback: true
  };
}

// Transform meeting notes endpoint
app.post("/api/transform", async (req, res) => {
  const { notes } = req.body;
  if (!notes || typeof notes !== "string" || !notes.trim()) {
    return res.status(400).json({ error: "O conteúdo das notas da reunião é obrigatório." });
  }

  try {
    const ai = getGenAI();

    const systemInstruction = `Você é um assistente especializado em transformar anotações de reuniões em DOCUMENTOS PROFISSIONAIS no Google Docs, prontos para envio a clientes de uma agência de marketing digital.
Sua tarefa é organizar e formatar o rascunho de forma limpa, elegante e corporativa.

REGRAS GERAIS E OBRIGATÓRIAS:
1. NÃO invente qualquer tipo de informação adicional. Mantenha 100% de fidelidade aos fatos contados.
2. NÃO altere o significado ou as opiniões expressas pelas pessoas.
3. NÃO resuma a ata principal (campo ata_reuniao). O conteúdo de discussões e falas deve ser mantido de forma completa e profissional.
4. NÃO reescreva falas ou simplifique jargões que mude o entendimento. Apenas estruture em terceira pessoa de forma elegante e limpa.
5. Remova SOMENTE:
   - Sobrenomes das pessoas (mantenha estritamente e apenas o primeiro nome simples de cada participante, ex: Sofia, Pedro, Ana).
   - Timestamps e marcações de tempo (ex: "00:00", "[03:45]", "(minuto 10)", "gravação 14:00").
6. É terminantemente PROIBIDO o uso de códigos e caracteres de Markdown rústicos no corpo do texto final (ex: '#', '##', '###', '***', '**', '_', '*' como marcadores ou títulos). Todo o conteúdo deve ser enviado como texto limpo e plano. Use novas linhas (\\n) para separar parágrafos de forma elegante.
7. O resultado final deve parecer um documento real, redigido por um redator profissional de agência, sem aparência automatizada ou redundâncias clássicas de IA.
8. Para a seção 'resumo_email': O resumo enviado deve conter estritamente 2 parágrafos fluidos, legíveis e amigáveis sobre o que foi conversado na reunião. É PROIBIDO inserir saudações (como 'Oi pessoal' ou 'Tudo bem?') ou encerramentos (como 'Abraços' ou 'Atenciosamente') no campo gerado, pois o sistema já os insere de forma fixa.`;

    const prompt = `Por favor, processe as seguintes anotações brutas de reunião de acordo com as regras estabelecidas:\n\n---\n${notes}\n---`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            data_reuniao: {
              type: Type.STRING,
              description: "Data da reunião extraída do texto no formato DD/MM/AAAA. Se não houver data explícita descrita nas anotações, use a data atual (ou deixe em branco se impossível estimar).",
            },
            participantes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Nomes dos participantes listados. Use EXCLUSIVAMENTE o primeiro nome de cada pessoa (remova sobrenomes).",
            },
            pauta: {
              type: Type.STRING,
              description: "Descrição clara e bem estruturada dos temas principais discutidos na reunião, em formato objetivo na terceira pessoa. Sem marcações Markdown.",
            },
            ata_reuniao: {
              type: Type.STRING,
              description: "A ata detalhada completa da reunião. Organize todo o conteúdo e discussões com parágrafos legíveis e estruturados. Não resuma. Não reescreva falas. Remova apenas sobrenomes e tempos de áudio. Não use nenhum tipo de markdown.",
            },
            proximos_passos: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Ações bem definidas que foram decididas ou delegadas. Lista de strings representando cada próximo passo de forma literal.",
            },
            resumo_planilha: {
              type: Type.STRING,
              description: "Texto corrido explicando a reunião de fato completo (contexto, decisões e desdobramentos). No final, adicione o texto 'Próximos passos:' e uma lista de cada ação exatamente como definida prefixada por um caractere hifen '- ' no início da linha, sem usar asteriscos ou negritos de markdown.",
            },
            resumo_email: {
              type: Type.STRING,
              description: "Resumo da reunião composto estritamente de exatamente dois parágrafos normais, usando linguagem profissional, amigável, leve e natural. Sem recortes ou bullet points, sem markdown, e SEM quaisquer saudações ou assinaturas.",
            }
          },
          required: ["data_reuniao", "participantes", "pauta", "ata_reuniao", "proximos_passos", "resumo_planilha", "resumo_email"]
        },
      },
    });

    const textOutput = response.text;
    if (!textOutput) {
      throw new Error("O modelo não retornou nenhum texto.");
    }

    const result = JSON.parse(textOutput.trim());

    // Post-process the resumo_email to enforce the exact demanded template:
    let bodyText = (result.resumo_email || "").trim();

    // Clean up any potential accidental duplication of headers or footers if the model generated them despite instructions
    bodyText = bodyText
      .replace(/^Ei,\s*pessoal!\s*Tudo\s*bem\??/gi, "")
      .replace(/^Muito\s*obrigada\s*pela\s*nossa\s*reunião\s*de\s*hoje\s*(:\))?/gi, "")
      .replace(/^Segue,\s*em\s*anexo,\s*a\s*ata\s*da\s*nossa\s*reunião\.?/gi, "")
      .replace(/Qualquer\s*coisa,\s*ficamos\s*à\s*disposição!?$/gi, "")
      .replace(/Abraços!?$/gi, "")
      .trim();

    // Re-verify it has 2 paragraphs or split paragraphs to keep only the actual summary content
    let paragraphs = bodyText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
    
    // Ensure we have exactly a concise summary of 2 paragraphs
    if (paragraphs.length === 0) {
      paragraphs = [
        "Durante a reunião, revisamos o andamento das tarefas e alinhamos as próximas prioridades do projeto.",
        "Discutimos também as métricas de desempenho e definimos os próximos passos a serem executados pela equipe."
      ];
    } else if (paragraphs.length > 2) {
      paragraphs = paragraphs.slice(0, 2);
    } else if (paragraphs.length === 1) {
      const sentences = paragraphs[0].match(/[^.!?]+[.!?]+/g) || [paragraphs[0]];
      if (sentences.length >= 2) {
        const mid = Math.ceil(sentences.length / 2);
        paragraphs = [
          sentences.slice(0, mid).join(" ").trim(),
          sentences.slice(mid).join(" ").trim()
        ];
      } else {
        paragraphs = [
          paragraphs[0],
          "Planejamos manter o foco nas ações prioritárias e analisar os novos resultados até o próximo encontro."
        ];
      }
    }

    const cleanedBody = paragraphs.join("\n\n");

    const intro = "Ei, pessoal! Tudo bem?\n\nMuito obrigada pela nossa reunião de hoje :)\n\nSegue, em anexo, a ata da nossa reunião.";
    const footer = "Qualquer coisa, ficamos à disposição!\n\nAbraços!";

    result.resumo_email = `${intro}\n\n${cleanedBody}\n\n${footer}`;

    return res.status(200).json(result);

  } catch (error: any) {
    const errorString = String(error?.message || "");
    const errorStatus = error?.status || error?.error?.status || "";
    const errorCode = error?.code || error?.statusCode || error?.error?.code || 0;
    
    const isQuotaExceeded = errorStatus === "RESOURCE_EXHAUSTED" || 
                            errorCode === 429 || 
                            errorString.includes("429") ||
                            errorString.toLowerCase().includes("quota") ||
                            errorString.toLowerCase().includes("exhausted");

    if (isQuotaExceeded) {
      console.warn("[Aviso de Cota Gemini] Limite de requisições excedido ou cota gratuita esgotada (429/RESOURCE_EXHAUSTED). Ativando o motor heurístico local.");
    } else {
      console.error("Erro ao transformar atas via Gemini API:", error);
    }
    
    // Recovery path: Gracefully fall back to rule-based parser instead of failing with 429 quota exceed
    try {
      const fallbackResult = parseNotesFallback(notes);
      console.log("Recuperação ativada com sucesso usando o gerador heurístico local.");
      return res.status(200).json(fallbackResult);
    } catch (fallbackError: any) {
      console.error("Erro no processamento do fallback:", fallbackError);
      return res.status(500).json({ 
        error: "Ocorreu um erro no servidor ao processar a ata.", 
        details: fallbackError.message || fallbackError 
      });
    }
  }
});

// Configure Vite or Static server
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Servidor] Em execução na porta ${PORT}`);
  });
}

setupServer();
