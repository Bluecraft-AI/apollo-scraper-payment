// Vercel API endpoint to serve configuration
export default function handler(req, res) {
    console.log('🔧 Config API called:', req.method, req.url);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method === 'GET') {
        try {
            // Log environment variables (without exposing sensitive data)
            console.log('Environment check:', {
                hasApifyToken: !!process.env.APIFY_TOKEN,
                hasActorId: !!process.env.APOLLO_ACTOR_ID,
                hasEmailWebhookUrl: !!process.env.EMAIL_WEBHOOK_URL
            });
            
            const config = {
                APIFY_TOKEN: process.env.APIFY_TOKEN || '',
                APOLLO_ACTOR_ID: process.env.APOLLO_ACTOR_ID || 'code_crafter/apollo-io-scraper',
                EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL || '',
                DEFAULT_SETTINGS: {
                    maxLeads: 50000,
                    defaultLeads: 100,
                    timeout: 3600000
                },
                API: {
                    baseUrl: 'https://api.apify.com/v2',
                    timeout: 30000
                },
                SECURITY: {
                    allowedOrigins: ['*'],
                    rateLimitPerMinute: 10
                }
            };
            
            console.log('✅ Config API responding successfully');
            res.status(200).json(config);
            
        } catch (error) {
            console.error('❌ Config API error:', error);
            res.status(500).json({ 
                error: 'Internal server error',
                message: error.message 
            });
        }
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
} 