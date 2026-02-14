#!/usr/bin/env node
const { exec } = require('child_process');
const path = require('path');

// Get test file from command line args
const testFile = process.argv[2] || 'tests/benchmarks/ImageLayerPooling.test.ts';

console.log(`Running test: ${testFile}`);

// Run the test
exec(`npm test ${testFile}`, { cwd: __dirname }, (error, stdout, stderr) => {
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  if (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
});