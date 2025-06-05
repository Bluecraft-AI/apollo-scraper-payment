#!/usr/bin/env node

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Apollo Scraper - Starting Server...\n');

// Check if required files exist
const requiredFiles = [
    'config.js',
    'background-monitor.js',
    'server.js',
    'index.html',
    'package.json'
];

console.log('📋 Checking required files...');
for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
        console.log(`✅ ${file}`);
    } else {
        console.error(`❌ Missing required file: ${file}`);
        process.exit(1);
    }
}

// Check if node_modules exists
if (!fs.existsSync('node_modules')) {
    console.log('\n📦 Installing dependencies...');
    const npmInstall = spawn('npm', ['install'], { stdio: 'inherit' });
    
    npmInstall.on('close', (code) => {
        if (code === 0) {
            console.log('✅ Dependencies installed successfully');
            startServer();
        } else {
            console.error('❌ Failed to install dependencies');
            process.exit(1);
        }
    });
} else {
    console.log('✅ Dependencies already installed');
    startServer();
}

function startServer() {
    console.log('\n🚀 Starting Apollo Scraper Server...');
    console.log('📍 Server will be available at: http://localhost:3000');
    console.log('🔧 Background monitoring: Automatic');
    console.log('📝 Logs: Check console and monitor.log\n');
    
    // Start the server
    const server = spawn('node', ['server.js'], { stdio: 'inherit' });
    
    server.on('close', (code) => {
        console.log(`\n🛑 Server stopped with code: ${code}`);
    });
    
    server.on('error', (error) => {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        server.kill('SIGINT');
    });
} 