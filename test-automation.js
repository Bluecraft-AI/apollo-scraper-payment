const { CONFIG } = require('./config.js');

/**
 * Test script for the automated Apollo Scraper workflow
 */

console.log('🧪 Testing Automated Apollo Scraper Workflow');
console.log('='.repeat(50));

// Test configuration
console.log('📋 Configuration Status:');
console.log(`✅ Apify Token: ${CONFIG.APIFY_TOKEN ? 'Configured' : '❌ Missing'}`);
console.log(`✅ Webhook URL: ${CONFIG.WEBHOOK_URL ? 'Configured' : '❌ Missing'}`);
console.log(`✅ Apollo Actor ID: ${CONFIG.APOLLO_ACTOR_ID ? 'Configured' : '❌ Missing'}`);

// Test webhook connectivity
async function testWebhook() {
    console.log('\n🔗 Testing Webhook Connectivity...');
    
    try {
        const axios = require('axios');
        const testPayload = {
            test: true,
            message: 'Test from automated workflow',
            timestamp: new Date().toISOString()
        };
        
        const response = await axios.post(CONFIG.WEBHOOK_URL, testPayload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Apollo-Scraper-Test/1.0'
            },
            timeout: 10000
        });
        
        console.log(`✅ Webhook test successful: ${response.status} ${response.statusText}`);
        if (response.data) {
            console.log(`📋 Response:`, response.data);
        }
        
        return true;
    } catch (error) {
        console.error(`❌ Webhook test failed: ${error.message}`);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data:`, error.response.data);
        }
        return false;
    }
}

// Test Apify API connectivity
async function testApifyAPI() {
    console.log('\n🔗 Testing Apify API Connectivity...');
    
    try {
        const axios = require('axios');
        const testUrl = `https://api.apify.com/v2/acts/${CONFIG.APOLLO_ACTOR_ID}?token=${CONFIG.APIFY_TOKEN}`;
        
        const response = await axios.get(testUrl, {
            timeout: 10000
        });
        
        console.log(`✅ Apify API test successful: ${response.status} ${response.statusText}`);
        console.log(`📋 Actor name: ${response.data.data?.name || 'Unknown'}`);
        
        return true;
    } catch (error) {
        console.error(`❌ Apify API test failed: ${error.message}`);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data:`, error.response.data);
        }
        return false;
    }
}

// Run all tests
async function runTests() {
    console.log('\n🚀 Running Automated Workflow Tests...\n');
    
    const webhookOK = await testWebhook();
    const apifyOK = await testApifyAPI();
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Results Summary:');
    console.log(`🔗 Webhook: ${webhookOK ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`🔗 Apify API: ${apifyOK ? '✅ PASS' : '❌ FAIL'}`);
    
    if (webhookOK && apifyOK) {
        console.log('\n🎉 All tests passed! The automated workflow should work correctly.');
        console.log('\n📝 Next steps:');
        console.log('1. Open index.html in your browser');
        console.log('2. Fill out the form with an Apollo URL');
        console.log('3. Click "Start Automated Workflow"');
        console.log('4. Check your webhook endpoint for results');
    } else {
        console.log('\n❌ Some tests failed. Please fix the issues before using the automated workflow.');
    }
}

// Run the tests
runTests().catch(console.error); 