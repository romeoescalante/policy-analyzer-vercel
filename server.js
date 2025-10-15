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

