// One JSON line per event, so CloudWatch Logs Insights can filter and aggregate them.
export function createLogger(write = line => console.log(line)) {
  const emit = level => (message, fields = {}) => write(JSON.stringify({ level, message, ...fields }));
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}
