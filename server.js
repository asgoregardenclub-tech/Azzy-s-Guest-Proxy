const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const GuestPool = require('./guestPool');

const app = express();
const PORT = process.env.PORT || 5000;
const POOL_SIZE = parseInt(process.env.POOL_SIZE || '5', 10);
const MAX_REQUESTS = parseInt(process.env.MAX_REQUESTS || '20', 10);

const pool = new GuestPool(POOL_SIZE, MAX_REQUESTS);

// CORS & Mixed Content / Private Network Access headers
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: '*' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '25mb' }));

/**
 * Strips Google internal citation/grounding URLs and metadata artifacts.
 */
function cleanArtifacts(text) {
  if (!text) return '';
  return text
    // 1. Strip all googleusercontent lmdx / citation URLs
    .replace(/https?:\/\/(?:[a-zA-Z0-9.-]+\.)?googleusercontent\.com\/[^\s)\]><"]+/gi, '')
    // 2. Clean leftover empty markdown links like [](http...) or [1](...)
    .replace(/\[\s*\d*\s*\]\(\s*\)/gi, '')
    // 3. Clean trailing bracketed footnotes e.g. [1], [2] at the very end
    .replace(/\s*\[\d+\](?=\s*$)/g, '')
    .trimEnd();
}

/**
 * Sliding buffer for streaming mode to prevent partial URLs from leaking.
 */
class StreamSanitizer {
  constructor(onSafeChunk) {
    this.buffer = '';
    this.onSafeChunk = onSafeChunk;
  }

  feed(chunk) {
    this.buffer += chunk;

    // Clean completed URLs in the buffer immediately
    this.buffer = cleanArtifacts(this.buffer);

    // Look for the beginning of a potential URL candidate near the end of the buffer
    const candidateIdx = this.buffer.search(/https?:\/\/(?:[a-zA-Z0-9.-]+\.)?googleusercontent\.com/i);
    const genericHttpIdx = this.buffer.search(/https?:\/\//i);

    if (candidateIdx !== -1) {
      // Flush safe text before the detected URL
      const safe = this.buffer.slice(0, candidateIdx);
      if (safe) this.onSafeChunk(safe);
      this.buffer = this.buffer.slice(candidateIdx);
    } else if (genericHttpIdx !== -1 && genericHttpIdx > this.buffer.length - 40) {
      // If an http:// starts within the last 40 chars, hold back that potential URL prefix
      const safe = this.buffer.slice(0, genericHttpIdx);
      if (safe) this.onSafeChunk(safe);
      this.buffer = this.buffer.slice(genericHttpIdx);
    } else {
      // No URL patterns detected: flush all but the last 15 chars (safety margin)
      if (this.buffer.length > 30) {
        const safe = this.buffer.slice(0, -15);
        this.onSafeChunk(safe);
        this.buffer = this.buffer.slice(-15);
      }
    }
  }

  flush() {
    // Run final clean on whatever remains in the buffer
    const finalCleaned = cleanArtifacts(this.buffer);
    if (finalCleaned) {
      this.onSafeChunk(finalCleaned);
    }
    this.buffer = '';
  }
}

// Format OpenAI messages array into roleplay prompt
function formatMessages(messages) {
  let prompt = '';
  for (const msg of messages) {
    const role = (msg.role || 'user').toLowerCase();
    const content = msg.content || '';
    if (role === 'system') {
      prompt += `[System Instruction: ${content}]\n\n`;
    } else if (role === 'user') {
      prompt += `User: ${content}\n\n`;
    } else if (role === 'assistant') {
      prompt += `Assistant: ${content}\n\n`;
    }
  }

  // Explicit constraint telling Gemini not to generate citations or URLs
  prompt += `[System Note: Do NOT output search citations, source URLs, or grounding links. Output only dialogue and character actions.]\n\n`;
  prompt += `Assistant:`;
  return prompt.trim();
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    type: 'Localhost Gemini Guest Proxy for JanitorAI',
    workers: pool.workers.map(w => ({
      id: w.id,
      requests: w.requestCount,
      onCooldown: w.cooldownUntil > Date.now()
    }))
  });
});

// OpenAI models endpoint
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'gemini-flash', object: 'model', owned_by: 'google' },
      { id: 'gemini-2.5-flash', object: 'model', owned_by: 'google' },
      { id: 'gemini-3.8-flash-thinking', object: 'model', owned_by: 'google' },
      { id: 'gemini-pro', object: 'model', owned_by: 'google' }
    ]
  });
});

// Chat completions endpoint
app.post(['/v1/chat/completions', '/chat/completions'], async (req, res) => {
  const { messages, stream = false, model = 'gemini-flash' } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: { message: 'Invalid messages format' } });
  }

  const formattedPrompt = formatMessages(messages);
  const completionId = `chatcmpl-${crypto.randomUUID()}`;
  const createdTime = Math.floor(Date.now() / 1000);

  let worker = null;
  try {
    worker = await pool.acquireWorker();
    console.log(`[Proxy] Routing request to Guest Worker #${worker.id} (Stream: ${stream})`);

    const chat = worker.client.newChat();

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // 1. Send initial role chunk
      res.write(`data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created: createdTime,
        model,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
      })}\n\n`);

      // 2. Stream sanitized content
      const sanitizer = new StreamSanitizer((safeText) => {
        res.write(`data: ${JSON.stringify({
          id: completionId,
          object: 'chat.completion.chunk',
          created: createdTime,
          model,
          choices: [{ index: 0, delta: { content: safeText }, finish_reason: null }]
        })}\n\n`);
      });

      const streamResult = await chat.generateContentStream({ prompt: formattedPrompt });

      for await (const chunk of streamResult) {
        const delta = chunk.text_delta || chunk.text || '';
        if (delta) {
          sanitizer.feed(delta);
        }
      }

      // Flush whatever remains safely
      sanitizer.flush();

      // 3. Final stop chunk
      res.write(`data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created: createdTime,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

      pool.releaseWorker(worker, false);
    } else {
      // Non-streaming response
      const response = await chat.generateContent({ prompt: formattedPrompt });
      const replyText = cleanArtifacts(response.text || '');

      pool.releaseWorker(worker, false);

      return res.json({
        id: completionId,
        object: 'chat.completion',
        created: createdTime,
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: replyText },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: Math.ceil(formattedPrompt.length / 4),
          completion_tokens: Math.ceil(replyText.length / 4),
          total_tokens: Math.ceil((formattedPrompt.length + replyText.length) / 4)
        }
      });
    }
  } catch (error) {
    console.error(`[Proxy] Error with Worker #${worker?.id}:`, error.message);
    if (worker) pool.releaseWorker(worker, true, error.message);

    if (!res.headersSent) {
      return res.status(500).json({
        error: {
          message: `Gemini Guest Proxy Error: ${error.message}`,
          type: 'internal_error'
        }
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  await pool.initialize();
  console.log(`\n=================================================`);
  console.log(`🚀 Gemini Guest Proxy is running!`);
  console.log(`📡 Localhost URL:      http://localhost:${PORT}/v1`);
  console.log(`📱 LAN / Mobile URL:    http://0.0.0.0:${PORT}/v1`);
  console.log(`🧹 Grounding Link Sanitizer: ACTIVE`);
  console.log(`=================================================\n`);
});
