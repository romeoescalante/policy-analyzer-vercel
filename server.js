import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdf from 'pdf-parse';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: '*', credentials: false }));

// health
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB para Render free

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /analyze  (solo PDF en Render)
app.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const mime = req.file.mimetype || '';
    if (!mime.includes('pdf')) {
      return res.status(400).json({ error: 'Images (OCR) not supported on Render free. Please upload a PDF.' });
    }

    const data = await pdf(req.file.buffer);
    const rawText = (data.text || '').trim();
    if (!rawText) return res.status(400).json({ error: 'Empty text extracted from PDF' });

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

app.listen(PORT, () => {
  console.log(`Analyzer on http://0.0.0.0:${PORT}`);
});
