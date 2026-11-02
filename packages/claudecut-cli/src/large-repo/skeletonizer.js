/**
 * AST Skeleton & Signature Extractor
 * Instead of Claude reading an entire 2,000-line file into context,
 * this extracts functions, classes, types, and exports as a compact "skeleton" (~90% smaller).
 */

function extractFileSkeleton(filePath, content) {
  if (typeof content !== 'string') return content;

  const lines = content.split('\n');
  // If file is already small (< 60 lines), no need to skeletonize
  if (lines.length <= 60) return content;

  const ext = filePath.split('.').pop().toLowerCase();

  // Python Skeleton Extractor
  if (ext === 'py') {
    const skeleton = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (
        trimmed.startsWith('import ') ||
        trimmed.startsWith('from ') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('def ') ||
        trimmed.startsWith('@')
      ) {
        skeleton.push(line);
        if (trimmed.startsWith('def ') || trimmed.startsWith('class ')) {
          skeleton.push('    # ... [Implementation truncated by ClaudeCut Large-Repo Engine] ...');
        }
      }
    }
    return skeleton.length > 5 ? skeleton.join('\n') : content;
  }

  // JS/TS/Go/Rust/Java/C Skeleton Extractor
  if (['js', 'ts', 'jsx', 'tsx', 'go', 'rs', 'java', 'cs', 'cpp', 'c', 'h'].includes(ext)) {
    const skeleton = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        trimmed.startsWith('import ') ||
        trimmed.startsWith('export ') ||
        trimmed.startsWith('interface ') ||
        trimmed.startsWith('type ') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('function ') ||
        trimmed.startsWith('func ') ||
        trimmed.startsWith('pub fn ') ||
        trimmed.startsWith('const ') && (trimmed.includes('=>') || trimmed.includes('function'))
      ) {
        skeleton.push(line);
      }
    }
    if (skeleton.length > 5) {
      skeleton.push('// ... [Full implementation available on explicit file read request] ...');
      return skeleton.join('\n');
    }
  }

  return content;
}

module.exports = { extractFileSkeleton };
