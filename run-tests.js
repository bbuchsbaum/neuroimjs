import { spawn } from 'child_process';

console.log('Running neuroimjs tests with Vitest...\n');

const vitest = spawn('npm', ['test', '--', '--run'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true
});

vitest.on('error', (error) => {
  console.error('Failed to start test process:', error);
});

vitest.on('exit', (code) => {
  console.log(`\nTests completed with exit code: ${code}`);
  process.exit(code);
});