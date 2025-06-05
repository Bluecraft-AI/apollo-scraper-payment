const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

// Simple temporary storage for Apollo URLs
// In production, you'd want to use Redis or a database
const TEMP_DIR = '/tmp/apollo-urls';

function ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
}

function storeApolloUrl(sessionId, fullUrl, email, leads, cleanOutput) {
    ensureTempDir();
    const data = {
        apolloUrl: fullUrl,
        email: email,
        leads: leads,
        cleanOutput: cleanOutput,
        timestamp: new Date().toISOString()
    };
    const filePath = path.join(TEMP_DIR, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Stored full Apollo URL for session ${sessionId}`);
}

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { leads, apolloUrl, email, cleanOutput } = req.body;

        // Validation
        if (!leads || typeof leads !== 'number' || leads < 500) {
            return res.status(400).json({ error: 'Minimum order is 500 leads ($2.50)' });
        }

        if (!apolloUrl || !apolloUrl.includes('apollo.io')) {
            return res.status(400).json({ error: 'Please provide a valid Apollo.io search URL' });
        }

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Please provide a valid email address' });
        }

        // Calculate amount in cents
        const amount = Math.round(leads * 0.005 * 100); // Convert to cents
        
        // Ensure minimum $2.50
        if (amount < 250) {
            return res.status(400).json({ error: 'Minimum order amount is $2.50' });
        }

        // Ensure maximum reasonable amount
        if (amount > 25000) { // $250 max (50,000 leads)
            return res.status(400).json({ error: 'Maximum order is 50,000 leads ($250)' });
        }

        console.log(`Creating checkout session for ${leads} leads ($${(amount/100).toFixed(2)}) for ${email}`);

        // Determine the base URL - prioritize custom domain
        const baseUrl = req.headers.origin || 
                       (req.headers.host?.includes('resources.bluecraftleads.com') ? 'https://resources.bluecraftleads.com' : null) ||
                       `https://${process.env.VERCEL_URL}` || 
                       'http://localhost:3000';

        console.log(`Using base URL: ${baseUrl}`);

        // Truncate Apollo URL for metadata (Stripe has 500 char limit per field)
        const truncatedUrl = apolloUrl.length > 450 ? apolloUrl.substring(0, 450) + '...' : apolloUrl;
        
        // Split full URL into chunks for Stripe metadata (500 char limit per field)
        const fullUrlBase64 = Buffer.from(apolloUrl).toString('base64');
        const chunkSize = 450; // Stay under 500 char limit
        const urlChunks = [];
        
        for (let i = 0; i < fullUrlBase64.length; i += chunkSize) {
            urlChunks.push(fullUrlBase64.slice(i, i + chunkSize));
        }
        
        // Generate a unique order ID for tracking
        const orderId = `apollo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        console.log(`Apollo URL length: ${apolloUrl.length} characters`);
        console.log(`Truncated for metadata: ${truncatedUrl.length} characters`);
        console.log(`Base64 encoded length: ${fullUrlBase64.length} characters`);
        console.log(`Split into ${urlChunks.length} chunks of max ${chunkSize} characters each`);

        // Create metadata object with URL chunks
        const metadata = {
            leads: leads.toString(),
            apolloUrl: truncatedUrl,
            email: email,
            cleanOutput: cleanOutput ? 'true' : 'false',
            timestamp: new Date().toISOString(),
            orderId: orderId,
            fullUrlLength: apolloUrl.length.toString(),
            urlChunkCount: urlChunks.length.toString()
        };

        // Add URL chunks as separate metadata fields
        urlChunks.forEach((chunk, index) => {
            metadata[`urlChunk${index}`] = chunk;
        });

        console.log(`Metadata fields: ${Object.keys(metadata).length}`);

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Apollo Scraper Leads',
                        description: `Purchase of ${leads.toLocaleString()} leads at $0.005 per lead`,
                        images: [], // You can add your logo URL here if you have one
                    },
                    unit_amount: amount,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${baseUrl}/lead-scraper/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/lead-scraper/payment-cancelled`,
            customer_email: email,
            metadata: metadata,
            payment_intent_data: {
                metadata: {
                    ...metadata,
                    service: 'apollo-scraper'
                }
            },
            billing_address_collection: 'auto',
            phone_number_collection: {
                enabled: true,
            },
            custom_text: {
                submit: {
                    message: 'Your leads will be processed and delivered to your email address within minutes after payment.'
                }
            }
        });

        console.log(`Checkout session created: ${session.id}`);

        // Store the full Apollo URL
        storeApolloUrl(session.id, apolloUrl, email, leads, cleanOutput);

        // Return the checkout URL
        res.status(200).json({
            url: session.url,
            sessionId: session.id
        });

    } catch (error) {
        console.error('Stripe checkout session creation error:', error);
        
        // Handle specific Stripe errors
        if (error.type === 'StripeCardError') {
            return res.status(400).json({ error: 'Your card was declined.' });
        } else if (error.type === 'StripeRateLimitError') {
            return res.status(429).json({ error: 'Too many requests made to the API too quickly.' });
        } else if (error.type === 'StripeInvalidRequestError') {
            return res.status(400).json({ error: 'Invalid parameters were supplied to Stripe.' });
        } else if (error.type === 'StripeAPIError') {
            return res.status(500).json({ error: 'An error occurred with Stripe API.' });
        } else if (error.type === 'StripeConnectionError') {
            return res.status(500).json({ error: 'A network error occurred.' });
        } else if (error.type === 'StripeAuthenticationError') {
            return res.status(500).json({ error: 'Authentication with Stripe failed.' });
        } else {
            return res.status(500).json({ error: 'An unexpected error occurred: ' + error.message });
        }
    }
} 