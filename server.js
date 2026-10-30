require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Tiny rate limit (20 requests/hour/IP) so a public link can't drain your API key.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  a.push(now); hits.set(ip, a);
  return a.length > 20;
}

const SYS = `You are an honest career coach for first-time job seekers (fresh graduates). Compare the CV to the job.
RULES: Never invent facts. Every rewrite must use only facts present in the CV and must quote the CV text it is based on in "evidence". If the job needs something the CV does not show, put it in "gaps", not in rewrites.
Return ONLY valid JSON, no markdown, in this exact shape:
{"beforeScore":0-100,"afterScore":0-100,"summary":"2 sentences",
"strengths":["..."],
"rewrites":[{"original":"CV line","improved":"stronger, job-relevant line using only CV facts","evidence":"exact CV text used"}],
"gaps":[{"skill":"...","why":"why the job needs it","plan":"7-day plan with a small project to prove it"}],
"warnings":["things NOT to claim because the CV has no evidence"]}
afterScore = realistic score if the rewrites were applied (not the gaps fixed). Give 3-5 rewrites, 2-4 gaps.`;

app.post('/api/analyze', async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in an hour.' });
    const { job = '', cv = '' } = req.body || {};
    if (job.length < 30 || cv.length < 30) return res.status(400).json({ error: 'Paste both a job post and your CV.' });
    const model = process.env.MODEL || 'gemini-3.5-flash-lite';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYS }] },
        contents: [{ role: 'user', parts: [{ text: `JOB:\n${job.slice(0, 6000)}\n\nCV:\n${cv.slice(0, 6000)}` }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 3000, temperature: 0.4 }
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error && d.error.message || 'API error');
    const parts = (d.candidates && d.candidates[0] && d.candidates[0].content.parts) || [];
    const t = parts.map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    res.json(JSON.parse(t));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'Could not analyze. Check your API key and try again.' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('JobKit running on http://localhost:' + port));
