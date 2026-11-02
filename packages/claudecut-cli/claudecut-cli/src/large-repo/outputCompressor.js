/**
 * Tool Output Compressor for Claude Code
 *
 * In massive projects, commands like `git diff`, `npm test`, `find`, `grep`,
 * or bash execution output thousands of lines of logs that sit idle in the
 * conversation history.
 *
 * This prunes repetitive logs, keeps head & tail error traces, and prevents
 * context explosion.
 */

function compressToolResult(content, maxLines = 120) {
  if (typeof content !== 'string') return content;

  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;

  // Keep the first 40 lines (command start/headers) and last 60 lines (actual errors/exit messages)
  const head = lines.slice(0, 40);
  const tail = lines.slice(lines.length - 60);

  const omittedCount = lines.length - 100;
  const compressed = [
    ...head,
    `\n... [ClaudeCut: ${omittedCount} lines of repetitive output truncated to prevent context blowup] ...\n`,
    ...tail
  ].join('\n');

  return compressed;
}

module.exports = { compressToolResult };
