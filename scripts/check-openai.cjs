// Quick OpenAI embeddings credential test. Run with:
//   node --env-file=.env scripts/check-openai.cjs
//
// Verifies:
//   1. OPENAI_API_KEY is set
//   2. The key can call the embedding model Jordan uses at runtime

const key = process.env.OPENAI_API_KEY || '';
const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large';
const endpoint = 'https://api.openai.com/v1/embeddings';

function printCredentialHint(message) {
  console.error('Credential to fix: OPENAI_API_KEY');
  console.error(`How to fix: ${message}`);
}

console.log('OpenAI embeddings credential test');
console.log('---');

if (!key) {
  console.error('FAIL: OPENAI_API_KEY not set in .env');
  printCredentialHint('copy a valid OpenAI API key with access to the embeddings API.');
  process.exit(1);
}

console.log(`OpenAI key prefix: ${key.slice(0, 7)}...`);
console.log(`Embedding model: ${model}`);
console.log('---');

const abortController = new AbortController();
const timeout = setTimeout(() => abortController.abort(), 10_000);

(async () => {
  let response;
  const start = Date.now();
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: 'daily installer openai smoke test',
      }),
      signal: abortController.signal,
    });
  } catch (err) {
    console.error('FAIL: network error reaching OpenAI embeddings API');
    console.error(err.message || err);
    printCredentialHint('check that the machine can reach api.openai.com, then rerun the installer.');
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }

  const elapsed = Date.now() - start;
  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>');
    console.error(`FAIL: OpenAI embeddings request rejected — ${response.status} ${response.statusText}`);
    console.error(`Body: ${body.slice(0, 500)}`);
    if (response.status === 401 || response.status === 403) {
      printCredentialHint('copy a valid OpenAI API key. Make sure it has access to the embeddings API.');
    } else if (response.status === 404) {
      printCredentialHint(`the key could not access model ${model}. Use an API key with access to that embedding model.`);
    } else if (response.status === 429) {
      printCredentialHint('the key was accepted but the OpenAI account is rate-limited or out of quota. Check billing/quota, then rerun the installer.');
    } else {
      printCredentialHint('the OpenAI embeddings request failed. Check the key, model access, and account status.');
    }
    process.exit(1);
  }

  const payload = await response.json().catch(() => undefined);
  const embedding = payload?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    console.error('FAIL: OpenAI response did not include an embedding vector.');
    printCredentialHint('the key reached OpenAI, but the embeddings response was unexpected. Check model access and rerun the installer.');
    process.exit(1);
  }

  console.log(`OpenAI embeddings authenticated (${response.status}, ${elapsed}ms, dimension=${embedding.length})`);
  console.log('OpenAI credential test PASSED.');
})();
