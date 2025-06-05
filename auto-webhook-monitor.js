const axios = require('axios');
const { CONFIG } = require('./config.js');

/**
 * Auto Webhook Monitor - Monitors an Apify run and automatically sends data to webhook when complete
 * 
 * Usage: node auto-webhook-monitor.js <RUN_ID>
 * Example: node auto-webhook-monitor.js PuFBkgE1VPTzfcxQy
 */

async function monitorAndSendWebhook(runId) {
    if (!runId) {
        console.error('❌ Please provide a run ID');
        console.log('Usage: node auto-webhook-monitor.js <RUN_ID>');
        process.exit(1);
    }

    console.log(`🔍 Monitoring run: ${runId}`);
    console.log(`🔗 Webhook URL: ${CONFIG.WEBHOOK_URL}`);
    
    const maxAttempts = 60; // Monitor for up to 30 minutes (30 seconds * 60)
    const checkInterval = 30000; // Check every 30 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`\n📡 Check ${attempt}/${maxAttempts} - Checking run status...`);
            
            // Get run information
            const runUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${CONFIG.APIFY_TOKEN}`;
            const runResponse = await axios.get(runUrl);
            const runData = runResponse.data.data;
            
            console.log(`📊 Run status: ${runData.status}`);
            
            if (runData.status === 'SUCCEEDED') {
                console.log('✅ Run completed successfully! Sending data to webhook...');
                
                // Get the dataset ID
                const datasetId = runData.defaultDatasetId;
                if (!datasetId) {
                    throw new Error('No dataset ID found in run data');
                }

                console.log(`🔍 Retrieving data from dataset: ${datasetId}`);

                // Get data from dataset
                const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${CONFIG.APIFY_TOKEN}`;
                const datasetResponse = await axios.get(datasetUrl, {
                    timeout: 30000
                });
                
                const scrapedData = datasetResponse.data;
                console.log(`📦 Retrieved ${scrapedData.length} items from dataset`);

                if (scrapedData.length === 0) {
                    console.log('⚠️ No data found in dataset');
                    return;
                }

                // Send data to webhook
                const payload = {
                    data: scrapedData,
                    metadata: {
                        success: true,
                        message: 'Data automatically sent after run completion',
                        totalRecords: scrapedData.length,
                        runId: runId,
                        datasetId: datasetId,
                        timestamp: new Date().toISOString(),
                        configuredWebhookUrl: CONFIG.WEBHOOK_URL,
                        retrievedAt: new Date().toISOString(),
                        runFinishedAt: runData.finishedAt,
                        runStartedAt: runData.startedAt,
                        automatedDelivery: true,
                        monitoringAttempts: attempt
                    }
                };

                console.log(`📤 Sending ${scrapedData.length} leads to webhook...`);
                console.log(`📊 Payload size: ${JSON.stringify(payload).length} characters`);

                const webhookResponse = await axios.post(CONFIG.WEBHOOK_URL, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Apify-Apollo-Auto-Monitor/1.0'
                    },
                    timeout: 60000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });

                console.log(`✅ Webhook response: ${webhookResponse.status} ${webhookResponse.statusText}`);
                
                if (webhookResponse.data) {
                    console.log(`📋 Webhook response data:`, webhookResponse.data);
                }

                console.log(`🎉 Successfully sent ${scrapedData.length} leads to webhook automatically!`);
                console.log(`⏱️ Total monitoring time: ${(attempt * checkInterval / 1000)} seconds`);
                
                return;
                
            } else if (runData.status === 'FAILED') {
                console.error('❌ Run failed');
                
                // Send error notification to webhook
                const errorPayload = {
                    data: [],
                    metadata: {
                        success: false,
                        error: 'Apollo scraper run failed',
                        message: 'Run monitoring detected failure',
                        totalRecords: 0,
                        runId: runId,
                        timestamp: new Date().toISOString(),
                        configuredWebhookUrl: CONFIG.WEBHOOK_URL,
                        automatedDelivery: true,
                        monitoringAttempts: attempt,
                        runStatus: runData.status
                    }
                };
                
                try {
                    await axios.post(CONFIG.WEBHOOK_URL, errorPayload, {
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': 'Apify-Apollo-Auto-Monitor/1.0'
                        },
                        timeout: 30000
                    });
                    console.log('📧 Error notification sent to webhook');
                } catch (webhookError) {
                    console.error('❌ Failed to send error notification:', webhookError.message);
                }
                
                process.exit(1);
                
            } else if (runData.status === 'ABORTED') {
                console.error('❌ Run was aborted');
                process.exit(1);
                
            } else {
                // Run is still in progress
                console.log(`⏳ Run still in progress (${runData.status}). Waiting ${checkInterval/1000} seconds...`);
                
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                }
            }
            
        } catch (error) {
            console.error(`❌ Error during monitoring attempt ${attempt}:`, error.message);
            
            if (attempt < maxAttempts) {
                console.log(`🔄 Retrying in ${checkInterval/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, checkInterval));
            }
        }
    }
    
    console.error(`❌ Monitoring timeout after ${maxAttempts} attempts (${(maxAttempts * checkInterval / 1000 / 60)} minutes)`);
    process.exit(1);
}

// Get run ID from command line arguments
const runId = process.argv[2];
monitorAndSendWebhook(runId); 