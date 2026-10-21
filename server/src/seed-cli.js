import { openDatabase } from './db.js';
import { seedDemo } from './seed.js';

const database = openDatabase();
try {
  await database.initialize();
  const result = await seedDemo(database);
  console.info(`Seeded synthetic demo workspace ${result.organizationId}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await database.close();
}
