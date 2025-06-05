const axios = require('axios');
const { CONFIG } = require('./config.js');

/**
 * Webhook Sender - Retrieves data from an Apify run and sends it to webhook
 * 
 * Usage: node webhook-sender.js <RUN_ID>
 * Example: node webhook-sender.js iPltQGSWOjyBaOuxt
 */

async function sendDataToWebhook(runId) {
    if (!runId) {
        console.error('❌ Please provide a run ID');
        console.log('Usage: node webhook-sender.js <RUN_ID>');
        console.log('Example: node webhook-sender.js iPltQGSWOjyBaOuxt');
        process.exit(1);
    }

    console.log(`🚀 Retrieving data from run: ${runId}`);
    console.log(`🔗 Webhook URL: ${CONFIG.WEBHOOK_URL}`);

    try {
        // Get run information
        const runUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${CONFIG.APIFY_TOKEN}`;
        console.log(`📡 Fetching run info from: ${runUrl}`);
        
        const runResponse = await axios.get(runUrl);
        const runData = runResponse.data.data;
        
        console.log(`✅ Run status: ${runData.status}`);
        console.log(`📊 Run finished at: ${runData.finishedAt}`);
        
        if (runData.status !== 'SUCCEEDED') {
            throw new Error(`Run did not succeed. Status: ${runData.status}`);
        }

        // Get the dataset ID
        const datasetId = runData.defaultDatasetId;
        if (!datasetId) {
            throw new Error('No dataset ID found in run data');
        }

        console.log(`🔍 Retrieving data from dataset: ${datasetId}`);

        // Get data from dataset
        const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${CONFIG.APIFY_TOKEN}`;
        console.log(`📡 Fetching data from: ${datasetUrl}`);
        
        const datasetResponse = await axios.get(datasetUrl);
        const scrapedData = datasetResponse.data;

        console.log(`📦 Retrieved ${scrapedData.length} items from dataset`);

        if (scrapedData.length === 0) {
            console.log('⚠️ No data found in dataset');
            return;
        }

        // Prepare webhook payload
        const payload = {
            data: scrapedData,
            metadata: {
                success: true,
                message: 'Data retrieved and sent successfully',
                totalRecords: scrapedData.length,
                runId: runId,
                datasetId: datasetId,
                timestamp: new Date().toISOString(),
                configuredWebhookUrl: CONFIG.WEBHOOK_URL,
                retrievedAt: new Date().toISOString(),
                runFinishedAt: runData.finishedAt,
                runStartedAt: runData.startedAt
            }
        };

        // Send to webhook as a single payload
        console.log(`📤 Sending ${scrapedData.length} leads to webhook...`);
        console.log(`📊 Payload size: ${JSON.stringify(payload).length} characters`);

        try {
            console.log(`📤 Sending all data in single request...`);
            
            const webhookResponse = await axios.post(CONFIG.WEBHOOK_URL, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Apify-Apollo-Webhook-Sender/1.0'
                },
                timeout: 60000, // 60 second timeout for large payload
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            console.log(`✅ Webhook response: ${webhookResponse.status} ${webhookResponse.statusText}`);
            console.log(`🎉 Successfully sent ${scrapedData.length} leads to webhook!`);
            
            if (webhookResponse.data) {
                console.log(`📋 Webhook response data:`, webhookResponse.data);
            }
            
        } catch (webhookError) {
            console.error(`❌ Failed to send data to webhook:`, webhookError.message);
            
            if (webhookError.response) {
                console.error(`❌ HTTP Error: ${webhookError.response.status} - ${webhookError.response.statusText}`);
                if (webhookError.response.data) {
                    console.error('❌ Response data:', webhookError.response.data);
                }
            }
            
            throw webhookError;
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        
        if (error.response) {
            console.error(`❌ HTTP Error: ${error.response.status} - ${error.response.statusText}`);
            if (error.response.data) {
                console.error('❌ Response data:', error.response.data);
            }
        }
        
        process.exit(1);
    }
}

// Get run ID from command line arguments
const runId = process.argv[2];
sendDataToWebhook(runId); 