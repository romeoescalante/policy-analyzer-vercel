import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdf from 'pdf-parse';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS básico
app.use(cors({ origin: '*', credentials: false }));

// Multer: límite 10 MB (bueno para plan free de Render)
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// --------- Esquema y prompt ----------
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
- English only.
- Infer policy_type if possible.
- confidence between 0 and 1.
- Output ONLY JSON.`;

// Cliente OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --------- Rutas ----------
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    // Parche: validar que realmente subieron un archivo multipart con el campo "file"
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: 'No file uploaded',
        hint: 'Send multipart/form-data with field "file". Example curl: curl -F "file=@/path/to/policy.pdf" https://TU-SERVICIO.onrender.com/analyze'
      });
    }

    const mime = req.file.mimetype || '';
    if (!mime.includes('pdf')) {
      return res.status(400).json({
        error: 'Images (OCR) not supported on Render free. Please upload a PDF.'
      });
    }

    // Extraer texto del PDF
    const data = await pdf(req.file.buffer);
    const rawText = (data.text || '').trim();
    if (!rawText) {
      return res.status(400).json({ error: 'Empty text extracted from PDF' });
    }

    // Llamada a OpenAI
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `POLICY_TEXT:\n${rawText}\n\nSCHEMA:\n${JSON.stringify(SCHEMA)}` }
      ]
    });

    const json = JSON.parse(completion.choices[0].message.content);
    return res.status(200).json(json);
  } catch (e) {
    console.error('Analyze error:', e?.message || e);
    return res.status(500).json({ error: 'Analysis failed', details: String(e?.message || e) });
  }
});

// Escuchar puerto
app.listen(PORT, () => {
  console.log(`Analyzer on http://0.0.0.0:${PORT}`);
});
