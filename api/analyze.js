import { OpenAI } from "openai";
import pdf from "pdf-parse";
import formidable from "formidable";
import { createWorker } from "tesseract.js";

export const config = { api: { bodyParser: false } };

const SCHEMA = {
  document_info: {
    carrier: "", policy_number: "", insured_name: "",
    effective_date: "", expiration_date: "", policy_type: ""
  },
  summary: "",
  coverages: [{ name: "", limit: "", deductible: "", notes: "" }],
  exclusions: [""],
  endorsements: [""],
  premiums_fees: { annual_premium: "", fees: [{ name: "", amount: "" }] },
  red_flags: [""],
  recommendations: [""],
  confidence: 0.0
};

const SYSTEM_PROMPT = `You are an INSURANCE POLICY ANALYST.
Return STRICTLY a valid JSON matching this schema:
${JSON.stringify(SCHEMA)}
Rules:
- If a field is missing, leave "".
- Dates in YYYY-MM-DD.
- Keep coverage limits/deductibles as text.
- English for keys and output text.
- Infer policy_type if possible.
- confidence between 0 and 1.
- Output ONLY JSON.`;

function parseForm(req) {
  const form = formidable({ multiples: false, maxFileSize: 25 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

async function extractTextFromFile(file) {
  const fs = await import("node:fs/promises");
  const buf = await fs.readFile(file.filepath);
  const mime = file.mimetype || "";

  if (mime.includes("pdf")) {
    const data = await pdf(buf);
    return (data.text || "").trim();
  }

  const worker = await createWorker("eng");
  const { data: { text } } = await worker.recognize(buf);
  await worker.terminate();
  return (text || "").trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { files } = await parseForm(req);
    const file = files.file;
    if (!file) return res.status(400).json({ error: "No file" });

    const rawText = await extractTextFromFile(file);
    if (!rawText) return res.status(400).json({ error: "Empty text after OCR" });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `POLICY_TEXT:\n${rawText}\n\nSCHEMA:\n${JSON.stringify(SCHEMA)}` }
      ]
    });

    const json = JSON.parse(completion.choices[0].message.content);
    return res.status(200).json(json);
  } catch (e) {
    console.error("Analyze error:", e?.message || e);
    return res.status(500).json({ error: "Analysis failed", details: String(e?.message || e) });
  }
}
