# ClaudeCut Integration Guide

ClaudeCut is 100% wire-compatible with the Anthropic Messages API. You can route any tool or library through ClaudeCut simply by pointing its `base_url` or `ANTHROPIC_BASE_URL` to `http://127.0.0.1:8000`.

---

## 1. Claude Code CLI

Set the `ANTHROPIC_BASE_URL` environment variable before running `claude`:

### macOS / Linux / WSL:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8000"
export ANTHROPIC_API_KEY="your-anthropic-api-key"
claude
```

### Windows (PowerShell):
```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8000"
$env:ANTHROPIC_API_KEY = "your-anthropic-api-key"
claude
```

---

## 2. Cursor IDE

1. Open Cursor Settings (`Ctrl + ,` or `Cmd + ,`).
2. Search for **Anthropic API Key** or **Models**.
3. Under Custom Base URL / OpenAI/Anthropic Base URL, enter:
   ```
   http://127.0.0.1:8000
   ```
4. Enter your Anthropic API Key as normal.

---

## 3. Python Anthropic SDK

```python
import anthropic

client = anthropic.Anthropic(
    api_key="your-anthropic-api-key",
    base_url="http://127.0.0.1:8000"  # Points to ClaudeCut Proxy
)

response = client.messages.create(
    model="claude-3-7-sonnet-20250219",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Explain quantum mechanics in one paragraph."}
    ]
)

print(response.content[0].text)
```

---

## 4. TypeScript / Node.js Anthropic SDK

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:8000',
});

async function run() {
  const message = await anthropic.messages.create({
    model: 'claude-3-7-sonnet-20250219',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello Claude!' }],
  });
  console.log(message.content);
}

run();
```

---

## 5. LiteLLM / LangChain / LlamaIndex

```python
from langchain_anthropic import ChatAnthropic

chat = ChatAnthropic(
    model_name="claude-3-7-sonnet-20250219",
    anthropic_api_url="http://127.0.0.1:8000",
    anthropic_api_key="your-api-key"
)
```
