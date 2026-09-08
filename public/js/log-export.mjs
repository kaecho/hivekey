// Pure export utility: no DOM or session dependencies, safe to test in Node.
export function logsToCsv(entries) {
  const columns = [
    ['Request ID', 'id'], ['Time', 'ts'], ['Status', 'status'], ['HTTP status', 'statusCode'],
    ['Model', 'model'], ['Channel', 'channelName'], ['Key (masked)', 'keyMasked'],
    ['Attempts', 'attempts'], ['Latency (ms)', 'latencyMs'], ['TTFT (ms)', 'ttftMs'],
    ['Prompt tokens', 'promptTokens'], ['Completion tokens', 'completionTokens'],
    ['Policy', 'policy'], ['Error', 'error'],
  ];
  const cell = (value) => {
    let text = String(value ?? '');
    // Neutralize spreadsheet formulas, including whitespace-prefixed formulas.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = [columns.map(([label]) => cell(label)).join(',')];
  for (const entry of entries) {
    const data = { ...entry, ts: entry.ts ? new Date(entry.ts).toISOString() : '', policy: entry.routing?.effectiveStrategy || '' };
    rows.push(columns.map(([, key]) => cell(data[key])).join(','));
  }
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}
