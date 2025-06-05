const Apify = require('apify');
const axios = require('axios');

// Load centralized configuration
const { CONFIG, validateConfig, getConfigStatus } = require('../config.js');

Apify.main(async () => {
    console.log('🚀 Starting Apollo Scraper with Automated Webhook Integration');
    
    // Check configuration
    const configStatus = getConfigStatus();
    if (!configStatus.isConfigured) {
        console.warn('⚠️ Configuration issues found:');
        configStatus.errors.forEach(error => console.warn(error));
    }
    
    // Get input parameters
    const input = await Apify.getInput();
    console.log('📥 Input received:', input);
    
    const {
        url,
        totalRecords = CONFIG.DEFAULT_SETTINGS.defaultLeads,
        fileName = CONFIG.DEFAULT_SETTINGS.defaultFileName,
        cleanOutput = CONFIG.DEFAULT_SETTINGS.cleanOutput,
        webhookUrl = CONFIG.WEBHOOK_URL // Use configured webhook URL as default
    } = input;
    
    // Validate required inputs
    if (!url) {
        throw new Error('❌ Apollo search URL is required');
    }
    
    if (!url.includes('app.apollo.io')) {
        throw new Error('❌ Invalid Apollo URL. Must be from app.apollo.io');
    }
    
    // Use configured webhook URL if none provided
    const finalWebhookUrl = webhookUrl || CONFIG.WEBHOOK_URL;
    
    if (!finalWebhookUrl || finalWebhookUrl === 'https://your-webhook-endpoint.com/apollo-data') {
        throw new Error('❌ Webhook URL is required. Please configure it in config.js');
    }
    
    try {
        // Validate webhook URL
        new URL(finalWebhookUrl);
    } catch (error) {
        throw new Error('❌ Invalid webhook URL format');
    }
    
    console.log(`🎯 Target: ${totalRecords} leads from Apollo`);
    console.log(`📁 File name: ${fileName}`);
    console.log(`🧹 Clean output: ${cleanOutput}`);
    console.log(`🔗 Webhook URL: ${finalWebhookUrl}`);
    
    let apolloRun = null;
    let scrapedData = [];
    
    try {
        // Call the existing Apollo scraper actor
        console.log('🔄 Starting Apollo scraper...');
        
        apolloRun = await Apify.call(CONFIG.APOLLO_ACTOR_ID, {
            url,
            totalRecords,
            fileName,
            cleanOutput
        });
        
        console.log('✅ Apollo scraper completed successfully');
        console.log('📊 Run info:', apolloRun);
        
        // Wait a moment for the dataset to be fully populated
        console.log('⏳ Waiting for dataset to be ready...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Get the scraped data from the actor's dataset
        if (apolloRun && apolloRun.defaultDatasetId) {
            console.log(`🔍 Retrieving data from dataset: ${apolloRun.defaultDatasetId}`);
            
            try {
                // Use Apify API directly to get data from external dataset
                const datasetUrl = `https://api.apify.com/v2/datasets/${apolloRun.defaultDatasetId}/items?token=${CONFIG.APIFY_TOKEN}`;
                console.log(`📡 Fetching data from: ${datasetUrl}`);
                
                const datasetResponse = await axios.get(datasetUrl, {
                    timeout: 30000 // 30 second timeout
                });
                
                scrapedData = datasetResponse.data;
                console.log(`📦 Retrieved ${scrapedData.length} items from external actor's dataset`);
                
            } catch (datasetError) {
                console.error('❌ Error retrieving data from external dataset:', datasetError.message);
                
                // Fallback: try using Apify client
                console.log('🔄 Trying fallback with Apify client...');
                try {
                    const datasetClient = Apify.newClient().dataset(apolloRun.defaultDatasetId);
                    const { items } = await datasetClient.listItems();
                    scrapedData = items;
                    console.log(`📦 Retrieved ${scrapedData.length} items using Apify client`);
                } catch (clientError) {
                    console.error('❌ Apify client also failed:', clientError.message);
                    
                    // Final fallback: check our own dataset
                    console.log('🔄 Final fallback: checking our own dataset...');
                    const dataset = await Apify.openDataset();
                    const datasetInfo = await dataset.getInfo();
                    
                    if (datasetInfo && datasetInfo.itemCount > 0) {
                        const { items } = await dataset.getData();
                        scrapedData = items;
                        console.log(`📦 Retrieved ${scrapedData.length} items from our dataset`);
                    }
                }
            }
        } else {
            console.log('🔍 No dataset ID in response, checking our own dataset...');
            
            // Fallback: try to get from our own dataset
            const dataset = await Apify.openDataset();
            const datasetInfo = await dataset.getInfo();
            
            if (datasetInfo && datasetInfo.itemCount > 0) {
                const { items } = await dataset.getData();
                scrapedData = items;
                console.log(`📦 Retrieved ${scrapedData.length} items from our dataset`);
            }
        }
        
        if (!scrapedData || scrapedData.length === 0) {
            console.log('⚠️ No data was scraped');
            
            // Send empty result to webhook
            await sendToWebhook(finalWebhookUrl, [], {
                success: true,
                message: 'Scraping completed but no data found',
                totalRecords: 0,
                fileName,
                timestamp: new Date().toISOString(),
                runId: apolloRun?.id || 'unknown',
                datasetId: apolloRun?.defaultDatasetId || 'unknown',
                runInfo: apolloRun
            });
            
            return;
        }
        
        // Process and clean the data if needed
        let processedData = scrapedData;
        
        if (cleanOutput) {
            console.log('🧹 Cleaning output data...');
            processedData = cleanData(scrapedData);
        }
        
        // Send data to webhook automatically
        console.log(`📤 Automatically sending ${processedData.length} leads to webhook...`);
        
        await sendToWebhook(finalWebhookUrl, processedData, {
            success: true,
            message: 'Data scraped and sent automatically',
            totalRecords: processedData.length,
            fileName,
            timestamp: new Date().toISOString(),
            runId: apolloRun?.id || 'unknown',
            datasetId: apolloRun?.defaultDatasetId || 'unknown',
            configuredWebhookUrl: CONFIG.WEBHOOK_URL,
            usedWebhookUrl: finalWebhookUrl,
            runFinishedAt: apolloRun?.finishedAt,
            runStartedAt: apolloRun?.startedAt,
            automatedDelivery: true
        });
        
        console.log('✅ Data successfully sent to webhook automatically');
        
        // Also save to dataset for backup
        await Apify.pushData(processedData);
        console.log('💾 Data saved to Apify dataset as backup');
        
        console.log('🎉 Automated workflow completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during automated workflow:', error);
        
        // Send error notification to webhook
        try {
            await sendToWebhook(finalWebhookUrl, [], {
                success: false,
                error: error.message,
                message: 'Automated scraping workflow failed',
                totalRecords: 0,
                fileName,
                timestamp: new Date().toISOString(),
                runId: apolloRun?.id || 'unknown',
                datasetId: apolloRun?.defaultDatasetId || 'unknown',
                configuredWebhookUrl: CONFIG.WEBHOOK_URL,
                usedWebhookUrl: finalWebhookUrl,
                automatedDelivery: true,
                errorDetails: {
                    message: error.message,
                    stack: error.stack
                }
            });
            console.log('📧 Error notification sent to webhook');
        } catch (webhookError) {
            console.error('❌ Failed to send error notification to webhook:', webhookError.message);
        }
        
        throw error;
    }
});

/**
 * Send data to webhook URL with enhanced error handling
 */
async function sendToWebhook(webhookUrl, data, metadata = {}) {
    try {
        const payload = {
            data: data,
            metadata: metadata
        };
        
        console.log(`🔗 Sending to webhook: ${webhookUrl}`);
        console.log(`📊 Payload size: ${JSON.stringify(payload).length} characters`);
        console.log(`📦 Data items: ${data.length}`);
        
        const response = await axios.post(webhookUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Apify-Apollo-Scraper-Automated/1.0'
            },
            timeout: 60000, // 60 second timeout for large payloads
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
        console.log(`✅ Webhook response: ${response.status} ${response.statusText}`);
        
        if (response.data) {
            console.log(`📋 Webhook response data:`, response.data);
        }
        
        if (response.status >= 200 && response.status < 300) {
            console.log('✅ Webhook delivery successful');
        } else {
            console.warn(`⚠️ Webhook returned non-success status: ${response.status}`);
        }
        
    } catch (error) {
        console.error('❌ Webhook delivery failed:', error.message);
        
        if (error.response) {
            console.error(`❌ Webhook error response: ${error.response.status} - ${error.response.statusText}`);
            if (error.response.data) {
                console.error('❌ Response data:', error.response.data);
            }
        }
        
        throw new Error(`Webhook delivery failed: ${error.message}`);
    }
}

/**
 * Clean and optimize the scraped data
 */
function cleanData(data) {
    return data.map(item => {
        // Remove null/undefined values and empty strings
        const cleaned = {};
        
        Object.keys(item).forEach(key => {
            const value = item[key];
            
            if (value !== null && value !== undefined && value !== '') {
                if (typeof value === 'object' && !Array.isArray(value)) {
                    // Recursively clean nested objects
                    const cleanedNested = cleanData([value])[0];
                    if (Object.keys(cleanedNested).length > 0) {
                        cleaned[key] = cleanedNested;
                    }
                } else if (Array.isArray(value)) {
                    // Clean arrays
                    const cleanedArray = value.filter(v => v !== null && v !== undefined && v !== '');
                    if (cleanedArray.length > 0) {
                        cleaned[key] = cleanedArray;
                    }
                } else {
                    cleaned[key] = value;
                }
            }
        });
        
        return cleaned;
    });
} 