const express = require('express');
const fs = require('fs');
const path = require('path');

// Load centralized configuration
const { CONFIG, getConfigStatus } = require('./config.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Check configuration on startup
const configStatus = getConfigStatus();
console.log('🔧 Configuration Status:');
if (configStatus.isConfigured) {
    console.log('✅ Configuration is ready');
    console.log(`✅ Webhook URL configured: ${CONFIG.WEBHOOK_URL}`);
    console.log(`✅ Apify API token configured: ${CONFIG.APIFY_TOKEN ? 'Yes' : 'No'}`);
} else {
    console.warn('⚠️ Configuration issues found:');
    configStatus.errors.forEach(error => console.warn(error));
}

// Middleware to parse JSON
app.use(express.json({ limit: '50mb' }));

// Webhook endpoint to receive Apollo data
app.post('/webhook/apollo-data', (req, res) => {
    try {
        console.log('🔗 Webhook received at:', new Date().toISOString());
        
        const { data, metadata } = req.body;
        
        console.log('📊 Metadata:', metadata);
        console.log(`📋 Received ${data.length} leads`);
        
        // Log configuration info if available
        if (metadata.configuredWebhookUrl) {
            console.log(`🔗 Configured webhook: ${metadata.configuredWebhookUrl}`);
            console.log(`🔗 Used webhook: ${metadata.usedWebhookUrl}`);
        }
        
        if (metadata.success) {
            console.log('✅ Scraping was successful');
            
            // Process the data
            processApolloData(data, metadata);
            
            // Save to file
            saveDataToFile(data, metadata);
            
            // Send success response
            res.status(200).json({
                success: true,
                message: 'Data received and processed successfully',
                recordsReceived: data.length,
                timestamp: new Date().toISOString(),
                webhookConfigured: CONFIG.WEBHOOK_URL !== 'https://your-webhook-endpoint.com/apollo-data'
            });
            
        } else {
            console.log('❌ Scraping failed:', metadata.error);
            
            // Handle error case
            handleScrapingError(metadata);
            
            // Send acknowledgment
            res.status(200).json({
                success: true,
                message: 'Error notification received',
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        
        res.status(500).json({
            success: false,
            error: 'Failed to process webhook data',
            timestamp: new Date().toISOString()
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Process the Apollo data
function processApolloData(data, metadata) {
    console.log('🔄 Processing Apollo data...');
    
    // Example processing: Extract emails
    const emails = data
        .filter(lead => lead.email && lead.email_status === 'verified')
        .map(lead => ({
            email: lead.email,
            name: lead.name,
            title: lead.title,
            company: lead.organization_name
        }));
    
    console.log(`📧 Found ${emails.length} verified emails`);
    
    // Example processing: Group by company
    const companyCounts = {};
    data.forEach(lead => {
        const company = lead.organization_name || 'Unknown';
        companyCounts[company] = (companyCounts[company] || 0) + 1;
    });
    
    console.log('🏢 Company distribution:', companyCounts);
    
    // Example processing: Extract phone numbers
    const phoneNumbers = data
        .filter(lead => lead.phone_numbers && lead.phone_numbers.length > 0)
        .map(lead => ({
            name: lead.name,
            phone: lead.phone_numbers[0].sanitized_number,
            company: lead.organization_name
        }));
    
    console.log(`📞 Found ${phoneNumbers.length} phone numbers`);
    
    // You can add your custom processing logic here
    // For example:
    // - Send emails to your CRM
    // - Update your database
    // - Send notifications
    // - Generate reports
}

// Save data to file
function saveDataToFile(data, metadata) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `apollo-data-${timestamp}.json`;
        const filePath = path.join(__dirname, 'data', fileName);
        
        // Create data directory if it doesn't exist
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Save the complete payload
        const payload = {
            metadata,
            data,
            receivedAt: new Date().toISOString()
        };
        
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
        console.log(`💾 Data saved to: ${filePath}`);
        
        // Also save a CSV version for easy viewing
        if (data.length > 0) {
            saveToCsv(data, timestamp);
        }
        
    } catch (error) {
        console.error('❌ Failed to save data to file:', error);
    }
}

// Save data to CSV format
function saveToCsv(data, timestamp) {
    try {
        const csvFileName = `apollo-data-${timestamp}.csv`;
        const csvFilePath = path.join(__dirname, 'data', csvFileName);
        
        // Define CSV headers
        const headers = [
            'name', 'email', 'title', 'organization_name', 'linkedin_url',
            'city', 'state', 'country', 'phone', 'email_status'
        ];
        
        // Create CSV content
        let csvContent = headers.join(',') + '\n';
        
        data.forEach(lead => {
            const row = headers.map(header => {
                let value = lead[header] || '';
                
                // Handle phone numbers
                if (header === 'phone' && lead.phone_numbers && lead.phone_numbers.length > 0) {
                    value = lead.phone_numbers[0].sanitized_number || '';
                }
                
                // Escape commas and quotes in CSV
                if (typeof value === 'string') {
                    value = value.replace(/"/g, '""');
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        value = `"${value}"`;
                    }
                }
                
                return value;
            });
            
            csvContent += row.join(',') + '\n';
        });
        
        fs.writeFileSync(csvFilePath, csvContent);
        console.log(`📊 CSV saved to: ${csvFilePath}`);
        
    } catch (error) {
        console.error('❌ Failed to save CSV:', error);
    }
}

// Handle scraping errors
function handleScrapingError(metadata) {
    console.log('🚨 Handling scraping error...');
    
    // Log error details
    const errorLog = {
        timestamp: new Date().toISOString(),
        error: metadata.error,
        fileName: metadata.fileName,
        message: metadata.message
    };
    
    // Save error log
    const errorLogPath = path.join(__dirname, 'logs', 'errors.json');
    
    // Create logs directory if it doesn't exist
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Append to error log file
    let errorLogs = [];
    if (fs.existsSync(errorLogPath)) {
        try {
            errorLogs = JSON.parse(fs.readFileSync(errorLogPath, 'utf8'));
        } catch (e) {
            errorLogs = [];
        }
    }
    
    errorLogs.push(errorLog);
    fs.writeFileSync(errorLogPath, JSON.stringify(errorLogs, null, 2));
    
    console.log(`📝 Error logged to: ${errorLogPath}`);
    
    // You can add additional error handling here:
    // - Send email notifications
    // - Post to Slack
    // - Update monitoring systems
}

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook/apollo-data`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 Shutting down webhook server...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('👋 Shutting down webhook server...');
    process.exit(0);
}); 