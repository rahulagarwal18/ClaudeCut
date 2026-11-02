const fs = require('fs');
const path = require('path');

/**
 * LocalPersistentState
 * Stores conversation facts, file touches, and task state locally on your machine.
 * Never expires (unlike cloud 60-min TTL), completely free (0 tokens).
 */
class LocalPersistentState {
  constructor(storageDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claudecut')) {
    this.storageDir = storageDir;
    if (!fs.existsSync(this.storageDir)) {
      try {
        fs.mkdirSync(this.storageDir, { recursive: true });
      } catch (e) {}
    }
    this.stateFile = path.join(this.storageDir, 'session_state.json');
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      }
    } catch (e) {}
    return {
      activeObjective: '',
      touchedFiles: [],
      recentFacts: [],
      lastUpdated: Date.now()
    };
  }

  save() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {}
  }

  recordFact(fact) {
    if (!fact || typeof fact !== 'string') return;
    if (!this.data.recentFacts.includes(fact)) {
      this.data.recentFacts.push(fact);
      if (this.data.recentFacts.length > 20) {
        this.data.recentFacts.shift(); // keep top 20 latest facts
      }
      this.save();
    }
  }

  recordTouchedFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return;
    if (!this.data.touchedFiles.includes(filePath)) {
      this.data.touchedFiles.push(filePath);
      if (this.data.touchedFiles.length > 30) {
        this.data.touchedFiles.shift();
      }
      this.save();
    }
  }

  getSummaryPrompt() {
    const lines = [];
    if (this.data.touchedFiles.length > 0) {
      lines.push(`Active Workspace Files: ${this.data.touchedFiles.slice(-10).join(', ')}`);
    }
    if (this.data.recentFacts.length > 0) {
      lines.push(`Established Facts & Outcomes:\n- ${this.data.recentFacts.slice(-8).join('\n- ')}`);
    }
    return lines.join('\n\n');
  }
}

module.exports = { LocalPersistentState };
