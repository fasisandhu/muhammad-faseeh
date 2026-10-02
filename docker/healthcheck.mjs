// Container HEALTHCHECK: liveness with the probe token (the health endpoint is not open).
const port = process.env.PORT ?? '3000';
const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
  headers: { 'X-Health-Token': process.env.HEALTH_CHECK_TOKEN ?? '' },
}).catch(() => null);
process.exit(response?.status === 200 ? 0 : 1);
