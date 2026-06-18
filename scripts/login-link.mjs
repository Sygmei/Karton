import { createServer } from 'vite';
import QRCode from 'qrcode';

await import('./migrate.mjs');

const lookup = process.argv[2] || process.env.SUPERADMIN_USERNAME || 'superadmin';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent'
});

try {
  const auth = await server.ssrLoadModule('/src/lib/server/auth.ts');
  const loginLinks = await server.ssrLoadModule('/src/lib/server/login-links.ts');
  const superadmin = await auth.ensureSuperadminUser();
  const user = await auth.findUserByLookup(lookup);
  if (!user) {
    throw new Error(`No user found for '${lookup}'`);
  }

  const link = await auth.createLoginLink({
    userId: user.id,
    baseUrl: loginLinks.resolveConfiguredBaseUrl()
  });
  const qr = await QRCode.toString(link.connectionUrl, {
    type: 'terminal',
    small: true,
    margin: 1
  });

  console.log(`User: ${user.username} (${user.id})`);
  console.log(`Role: ${user.role}`);
  if (user.username === superadmin.username) {
    console.log('Seeded superadmin account confirmed.');
  }
  console.log();
  console.log(qr);
  console.log(`Connection link: ${link.connectionUrl}`);
  console.log(`Expires at: ${link.expiresAt.toISOString()}`);
} finally {
  await server.close();
}
