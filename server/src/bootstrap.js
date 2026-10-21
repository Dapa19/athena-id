import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { openDatabase } from './db.js';

const database = openDatabase();

try {
  if (process.env.NODE_ENV !== 'production') throw new Error('Set NODE_ENV=production before bootstrapping a production owner.');
  const organizationName = (process.env.BOOTSTRAP_ORG_NAME || '').trim();
  const displayName = (process.env.BOOTSTRAP_OWNER_NAME || '').trim();
  const email = (process.env.BOOTSTRAP_OWNER_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD || '';
  if (!organizationName || organizationName.length > 120) throw new Error('Set BOOTSTRAP_ORG_NAME (1–120 characters).');
  if (!displayName || displayName.length > 100) throw new Error('Set BOOTSTRAP_OWNER_NAME (1–100 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set a valid BOOTSTRAP_OWNER_EMAIL.');
  if (password.length < 12 || password.length > 200) throw new Error('Set BOOTSTRAP_OWNER_PASSWORD to at least 12 characters.');

  await database.initialize();
  const organizationCount = await database.get('SELECT COUNT(*) AS count FROM organizations');
  if (organizationCount.count > 0) throw new Error('This database already has an organization. Bootstrap only an empty production database.');
  const passwordHash = await bcrypt.hash(password, 12);
  await database.transaction(async (tx) => {
    const organization = await tx.run('INSERT INTO organizations (name, slug) VALUES (?, ?)', [organizationName, `org-${randomUUID()}`]);
    const user = await tx.run('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)', [email, displayName, passwordHash]);
    await tx.run('INSERT INTO organization_memberships (user_id, organization_id, role) VALUES (?, ?, ?)', [user.lastID, organization.lastID, 'owner_admin']);
  });
  console.info(`Production Owner/Admin created for ${email}. No demo data was seeded.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await database.close();
}
