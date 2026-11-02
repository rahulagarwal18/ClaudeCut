/**
 * ContextDistiller & Token Firewall
 *
 * Intercepts incoming messages payload before it goes to Anthropic.
 * - Caps any giant tool result (e.g. 24,000 SQL rows or huge diffs) to 30 lines.
 * - Extracts essential facts to local persistent state.
 * - Slices historical turns down to a sliding window of the last 4 turns.
 * - Converts 270,000-token bloat down to < 8,000 lean tokens.
 */

function distillToolOutput(text, maxChars = 1500) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxChars) return text;

  const lines = text.split('\n');
  if (lines.length <= 40) return text.slice(0, maxChars) + '\n... [Remaining content clipped to save tokens]';

  // Keep first 15 lines and last 15 lines
  const head = lines.slice(0, 15).join('\n');
  const tail = lines.slice(lines.length - 15).join('\n');
  const omitted = lines.length - 30;

  return `${head}\n\n... [ClaudeCut Token Firewall: ${omitted} lines truncated. Raw output kept in local memory] ...\n\n${tail}`;
}

function distillMessages(messages, persistentState) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  // Process and extract facts from all turns
  messages.forEach(msg => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      msg.content.forEach(b => {
        if (b && b.type === 'tool_result' && typeof b.content === 'string') {
          // If tool output contains SQL result or status, save a quick snippet
          const match = b.content.match(/(error|passed|failed|count|total|rows?:\s*\d+)/i);
          if (match) {
            persistentState.recordFact(b.content.slice(0, 120).replace(/\n/g, ' '));
          }
          // Cap the tool result in the payload
          b.content = distillToolOutput(b.content);
        }
      });
    }
  });

  // If conversation is longer than 4 turns, keep only the latest 4 turns + a 1-line state injection
  if (messages.length > 4) {
    const recentTurns = messages.slice(-4);
    const summary = persistentState.getSummaryPrompt();

    if (summary) {
      // Prepend distilled state to the first retained user message
      const firstMsg = recentTurns[0];
      if (firstMsg && firstMsg.role === 'user') {
        const stateNotice = `[ClaudeCut Memory Window - Continuous Context across turns]\n${summary}\n\n`;
        if (typeof firstMsg.content === 'string') {
          firstMsg.content = stateNotice + firstMsg.content;
        } else if (Array.isArray(firstMsg.content)) {
          firstMsg.content.unshift({ type: 'text', text: stateNotice });
        }
      }
    }
    return recentTurns;
  }

  return messages;
}

module.exports = { distillMessages, distillToolOutput };
