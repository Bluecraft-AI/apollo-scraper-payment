#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Building Apollo Scraper...');

// Read the index.html file
const indexPath = path.join(__dirname, 'index.html');
let htmlContent = fs.readFileSync(indexPath, 'utf8');

// Replace environment variable placeholders
const replacements = {
    '{{APIFY_TOKEN}}': process.env.APIFY_TOKEN || '',
    '{{WEBHOOK_URL}}': process.env.WEBHOOK_URL || '',
    '{{APOLLO_ACTOR_ID}}': process.env.APOLLO_ACTOR_ID || 'bluecraftai~apollo-scraper'
};

console.log('🔄 Replacing environment variables...');
for (const [placeholder, value] of Object.entries(replacements)) {
    htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), value);
    console.log(`   ${placeholder} -> ${value ? '✅ Set' : '❌ Not set'}`);
}

// Write the processed HTML to a build directory
const buildDir = path.join(__dirname, 'dist');
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
}

const outputPath = path.join(buildDir, 'index.html');
fs.writeFileSync(outputPath, htmlContent);

console.log('✅ Build completed!');
console.log(`📁 Output: ${outputPath}`);

// Copy other necessary files
const filesToCopy = ['package.json', 'server.js', 'background-monitor.js', 'config.js'];
filesToCopy.forEach(file => {
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, path.join(buildDir, file));
        console.log(`📋 Copied: ${file}`);
    }
});

// Copy api directory
const apiDir = path.join(__dirname, 'api');
const buildApiDir = path.join(buildDir, 'api');
if (fs.existsSync(apiDir)) {
    if (!fs.existsSync(buildApiDir)) {
        fs.mkdirSync(buildApiDir);
    }
    const apiFiles = fs.readdirSync(apiDir);
    apiFiles.forEach(file => {
        fs.copyFileSync(path.join(apiDir, file), path.join(buildApiDir, file));
        console.log(`📋 Copied: api/${file}`);
    });
}

console.log('🚀 Apollo Scraper build ready for deployment!'); 