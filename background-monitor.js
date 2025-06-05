const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load configuration
let config;
try {
    const configPath = path.join(__dirname, 'config.js');
    const configContent = fs.readFileSync(configPath, 'utf8');
    // Extract CONFIG object from the file
    const configMatch = configContent.match(/const CONFIG = ({[\s\S]*?});/);
    if (configMatch) {
        config = eval('(' + configMatch[1] + ')');
    } else {
        throw new Error('CONFIG object not found in config.js');
    }
    console.log('✅ Configuration loaded successfully');
} catch (error) {
    console.error('❌ Failed to load configuration:', error.message);
    process.exit(1);
}

class BackgroundMonitor {
    constructor() {
        this.activeRuns = new Map();
        this.maxAttempts = 120; // Monitor for up to 60 minutes (120 * 30 seconds)
        this.checkInterval = 30000; // Check every 30 seconds
        this.logFile = path.join(__dirname, 'monitor.log');
        
        console.log('🚀 Background Monitor initialized');
        console.log(`📊 Max monitoring time: ${this.maxAttempts * this.checkInterval / 1000 / 60} minutes`);
        console.log(`🔗 Webhook URL: ${config.WEBHOOK_URL}`);
        console.log(`📝 Log file: ${this.logFile}`);
    }

    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}`;
        
        console.log(logMessage);
        
        // Also write to log file
        try {
            fs.appendFileSync(this.logFile, logMessage + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    async startMonitoring(runId, metadata = {}) {
        if (this.activeRuns.has(runId)) {
            this.log(`⚠️ Run ${runId} is already being monitored`, 'WARN');
            return;
        }

        this.log(`🔍 Starting monitoring for run: ${runId}`);
        
        const monitoringData = {
            runId,
            startTime: new Date(),
            attempts: 0,
            metadata,
            status: 'MONITORING'
        };

        this.activeRuns.set(runId, monitoringData);
        
        // Start monitoring in background
        this.monitorRun(runId);
        
        return runId;
    }

    async monitorRun(runId) {
        const monitoringData = this.activeRuns.get(runId);
        if (!monitoringData) {
            this.log(`❌ Monitoring data not found for run: ${runId}`, 'ERROR');
            return;
        }

        try {
            for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
                monitoringData.attempts = attempt;
                
                this.log(`📡 [${runId}] Check ${attempt}/${this.maxAttempts} - Checking run status...`);
                
                try {
                    // Get run information
                    const runUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${config.APIFY_TOKEN}`;
                    const runResponse = await axios.get(runUrl);
                    
                    const status = runResponse.data.data.status;
                    monitoringData.status = status;
                    
                    this.log(`📊 [${runId}] Run status: ${status}`);
                    
                    if (status === 'SUCCEEDED') {
                        this.log(`✅ [${runId}] Run completed successfully! Sending data to webhook...`);
                        
                        await this.handleSuccessfulRun(runId, runResponse.data.data);
                        this.activeRuns.delete(runId);
                        return;
                        
                    } else if (status === 'FAILED' || status === 'ABORTED') {
                        this.log(`❌ [${runId}] Run ${status.toLowerCase()}`, 'ERROR');
                        
                        await this.handleFailedRun(runId, status, runResponse.data.data);
                        this.activeRuns.delete(runId);
                        return;
                        
                    } else {
                        // Run is still in progress
                        this.log(`⏳ [${runId}] Run still in progress (${status}). Waiting 30 seconds...`);
                        
                        if (attempt < this.maxAttempts) {
                            await this.sleep(this.checkInterval);
                        }
                    }
                    
                } catch (error) {
                    this.log(`❌ [${runId}] Error during monitoring attempt ${attempt}: ${error.message}`, 'ERROR');
                    
                    if (attempt < this.maxAttempts) {
                        this.log(`🔄 [${runId}] Retrying in 30 seconds...`);
                        await this.sleep(this.checkInterval);
                    } else {
                        await this.handleMonitoringError(runId, error);
                        this.activeRuns.delete(runId);
                    }
                }
            }
            
            // Timeout reached
            this.log(`⏰ [${runId}] Monitoring timeout after ${this.maxAttempts * this.checkInterval / 1000 / 60} minutes`, 'WARN');
            await this.handleTimeout(runId);
            this.activeRuns.delete(runId);
            
        } catch (error) {
            this.log(`❌ [${runId}] Fatal monitoring error: ${error.message}`, 'ERROR');
            this.activeRuns.delete(runId);
        }
    }

    async handleSuccessfulRun(runId, runData) {
        try {
            // Get the dataset ID and send data to webhook
            const datasetId = runData.defaultDatasetId;
            if (!datasetId) {
                throw new Error('No dataset ID found in run data');
            }

            this.log(`🔍 [${runId}] Retrieving data from dataset: ${datasetId}`);

            // Get data from dataset
            const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${config.APIFY_TOKEN}`;
            const datasetResponse = await axios.get(datasetUrl);
            
            const scrapedData = datasetResponse.data;
            this.log(`📦 [${runId}] Retrieved ${scrapedData.length} items from dataset`);

            if (scrapedData.length === 0) {
                this.log(`⚠️ [${runId}] Scraping completed but no data found in dataset`, 'WARN');
                
                // Send empty result notification
                await this.sendWebhookNotification(runId, {
                    success: true,
                    message: 'Scraping completed but no data found',
                    data: [],
                    totalRecords: 0
                });
                return;
            }

            // Send data to webhook
            const payload = {
                data: scrapedData,
                metadata: {
                    success: true,
                    message: 'Data automatically sent by background monitor',
                    totalRecords: scrapedData.length,
                    runId: runId,
                    datasetId: datasetId,
                    timestamp: new Date().toISOString(),
                    configuredWebhookUrl: config.WEBHOOK_URL,
                    automatedDelivery: true,
                    backgroundMonitor: true,
                    monitoringAttempts: this.activeRuns.get(runId)?.attempts || 0,
                    runStartedAt: runData.startedAt,
                    runFinishedAt: runData.finishedAt
                }
            };

            this.log(`📤 [${runId}] Sending ${scrapedData.length} leads to webhook...`);

            const webhookResponse = await axios.post(config.WEBHOOK_URL, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Apify-Apollo-Background-Monitor/1.0'
                },
                timeout: 30000 // 30 second timeout
            });

            this.log(`✅ [${runId}] Webhook response: ${webhookResponse.status}`);
            this.log(`🎉 [${runId}] SUCCESS: ${scrapedData.length} leads sent to webhook successfully!`);

        } catch (error) {
            this.log(`❌ [${runId}] Error handling successful run: ${error.message}`, 'ERROR');
            
            // Send error notification to webhook
            await this.sendWebhookNotification(runId, {
                success: false,
                message: `Error processing successful run: ${error.message}`,
                error: error.message
            });
        }
    }

    async handleFailedRun(runId, status, runData) {
        this.log(`❌ [${runId}] Handling failed run with status: ${status}`, 'ERROR');
        
        await this.sendWebhookNotification(runId, {
            success: false,
            message: `Apollo scraper run ${status.toLowerCase()}`,
            runStatus: status,
            runData: {
                startedAt: runData.startedAt,
                finishedAt: runData.finishedAt,
                stats: runData.stats
            }
        });
    }

    async handleMonitoringError(runId, error) {
        this.log(`❌ [${runId}] Handling monitoring error: ${error.message}`, 'ERROR');
        
        await this.sendWebhookNotification(runId, {
            success: false,
            message: `Monitoring failed: ${error.message}`,
            error: error.message
        });
    }

    async handleTimeout(runId) {
        this.log(`⏰ [${runId}] Handling monitoring timeout`, 'WARN');
        
        await this.sendWebhookNotification(runId, {
            success: false,
            message: `Monitoring timeout after ${this.maxAttempts * this.checkInterval / 1000 / 60} minutes`,
            timeout: true
        });
    }

    async sendWebhookNotification(runId, data) {
        try {
            const payload = {
                runId,
                timestamp: new Date().toISOString(),
                backgroundMonitor: true,
                ...data
            };

            const response = await axios.post(config.WEBHOOK_URL, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Apify-Apollo-Background-Monitor/1.0'
                },
                timeout: 30000
            });

            this.log(`📤 [${runId}] Webhook notification sent: ${response.status}`);
        } catch (error) {
            this.log(`❌ [${runId}] Failed to send webhook notification: ${error.message}`, 'ERROR');
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getStatus() {
        const activeRunIds = Array.from(this.activeRuns.keys());
        const runDetails = Array.from(this.activeRuns.values()).map(run => ({
            runId: run.runId,
            status: run.status,
            attempts: run.attempts,
            startTime: run.startTime,
            elapsedMinutes: Math.round((new Date() - run.startTime) / 1000 / 60)
        }));

        return {
            activeRuns: activeRunIds.length,
            runs: runDetails
        };
    }

    stopMonitoring(runId) {
        if (this.activeRuns.has(runId)) {
            this.activeRuns.delete(runId);
            this.log(`🛑 [${runId}] Monitoring stopped manually`);
            return true;
        }
        return false;
    }

    stopAll() {
        const runIds = Array.from(this.activeRuns.keys());
        this.activeRuns.clear();
        this.log(`🛑 Stopped monitoring ${runIds.length} runs: ${runIds.join(', ')}`);
        return runIds;
    }
}

// Create global monitor instance
const monitor = new BackgroundMonitor();

// Handle command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log(`
🚀 Apollo Scraper Background Monitor

Usage:
  node background-monitor.js <runId>              - Monitor a specific run
  node background-monitor.js status               - Show monitoring status
  node background-monitor.js stop <runId>         - Stop monitoring a run
  node background-monitor.js stop-all             - Stop all monitoring

Examples:
  node background-monitor.js abc123def456         - Start monitoring run abc123def456
  node background-monitor.js status               - Show current status
  node background-monitor.js stop abc123def456    - Stop monitoring run abc123def456
  node background-monitor.js stop-all             - Stop all active monitoring

The monitor will:
✅ Run independently of your browser
✅ Check run status every 30 seconds
✅ Monitor for up to 60 minutes per run
✅ Send webhook notifications when complete
✅ Log all activity to monitor.log
✅ Handle multiple runs simultaneously
    `);
    process.exit(0);
}

const command = args[0];

if (command === 'status') {
    const status = monitor.getStatus();
    console.log('\n📊 Background Monitor Status:');
    console.log(`Active runs: ${status.activeRuns}`);
    
    if (status.runs.length > 0) {
        console.log('\nRun Details:');
        status.runs.forEach(run => {
            console.log(`  🔍 ${run.runId}: ${run.status} (${run.attempts} checks, ${run.elapsedMinutes}min)`);
        });
    } else {
        console.log('No active monitoring sessions');
    }
    
    process.exit(0);
    
} else if (command === 'stop') {
    const runId = args[1];
    if (!runId) {
        console.error('❌ Please provide a run ID to stop');
        process.exit(1);
    }
    
    const stopped = monitor.stopMonitoring(runId);
    if (stopped) {
        console.log(`✅ Stopped monitoring run: ${runId}`);
    } else {
        console.log(`⚠️ Run ${runId} was not being monitored`);
    }
    
    process.exit(0);
    
} else if (command === 'stop-all') {
    const stoppedRuns = monitor.stopAll();
    console.log(`✅ Stopped monitoring ${stoppedRuns.length} runs`);
    process.exit(0);
    
} else {
    // Assume it's a run ID
    const runId = command;
    
    if (!runId.match(/^[a-zA-Z0-9]+$/)) {
        console.error('❌ Invalid run ID format');
        process.exit(1);
    }
    
    console.log(`🚀 Starting background monitoring for run: ${runId}`);
    monitor.startMonitoring(runId);
    
    // Keep the process running
    process.on('SIGINT', () => {
        console.log('\n🛑 Received SIGINT, stopping all monitoring...');
        monitor.stopAll();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\n🛑 Received SIGTERM, stopping all monitoring...');
        monitor.stopAll();
        process.exit(0);
    });
    
    // Keep process alive
    setInterval(() => {
        // Just keep the process running
    }, 60000);
} 