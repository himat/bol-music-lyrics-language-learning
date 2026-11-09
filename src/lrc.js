function parseTimestamp(minutes, seconds, fraction = '0') {
  const millis = fraction.length === 3 ? Number(fraction) : Number(fraction.padEnd(2, '0')) * 10;
  return Number(minutes) * 60000 + Number(seconds) * 1000 + millis;
}

function parseLRC(input = '') {
  const lines = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = rawLine.replace(/\[[^\]]+\]/g, '').trim();
    if (!text || timestamps.length === 0) continue;
    for (const match of timestamps) {
      lines.push({ timeMs: parseTimestamp(match[1], match[2], match[3]), text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs).map((line, index) => ({ ...line, index }));
}

function activeLineIndex(lines, positionMs) {
  let answer = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].timeMs > positionMs) break;
    answer = index;
  }
  return answer;
}

module.exports = { parseLRC, activeLineIndex };
