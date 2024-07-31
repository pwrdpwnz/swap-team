const { execSync } = require('child_process');

try {
  execSync('npx ajv validate -s schema.json -d data.json', { stdio: 'inherit' });
} catch (error) {
  console.error('Error during ajv validation', error);
  process.exit(1);
}
