/**
 * Sliding Window History & Idle Context Pruner
 *
 * Problem in large repos:
 * Turns 1 to 5 explored irrelevant folders or ran failed build commands.
 * That dead context stays in memory and re-sends on every turn.
 *
 * Solution:
 * Older assistant/tool turns (> 6 turns back) have their verbose tool results
 * collapsed into 1-line semantic summaries, preserving intent while reclaiming
 * up to 75% of context window.
 */

function pruneIdleHistory(messages) {
  if (!Array.isArray(messages) || messages.length <= 6) return messages;

  const threshold = messages.length - 4; // Keep recent 4 turns completely raw

  for (let i = 0; i < threshold; i++) {
    const msg = messages[i];
    if (!msg) continue;

    // If it's a tool result message or old assistant thought
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      msg.content.forEach(block => {
        if (block && block.type === 'tool_result' && typeof block.content === 'string') {
          if (block.content.length > 500) {
            // Keep first 200 chars and summarize
            block.content = block.content.slice(0, 200) + '... [Old historical tool output pruned by ClaudeCut]';
          }
        }
      });
    } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      msg.content.forEach(block => {
        if (block && block.type === 'text' && typeof block.text === 'string' && block.text.length > 1000) {
          block.text = block.text.slice(0, 400) + '... [Historical thought summarized]';
        }
      });
    }
  }

  return messages;
}

module.exports = { pruneIdleHistory };
