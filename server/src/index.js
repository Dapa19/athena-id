import { createApp } from './app.js';
import { openDatabase } from './db.js';
import { seedDemo } from './seed.js';
import { isProduction } from './config.js';

const database = openDatabase();

try {
  await database.initialize();
  if (!isProduction && process.env.SEED_DEMO_DATA !== 'false') {
    await seedDemo(database);
    console.info('Synthetic development data is available in the demo workspace.');
  }
  const app = createApp({ database });
  const port = Number(process.env.PORT) || 4000;
  const server = app.listen(port, '127.0.0.1', () => {
    console.info(`Athena API listening on http://127.0.0.1:${port}`);
  });

  const shutdown = () => server.close(async () => {
    await database.close();
    process.exit(0);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Could not start Athena API:', error.message);
  await database.close();
  process.exitCode = 1;
}
